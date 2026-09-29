-- #55 Ocultar el chat a cliente y profesional cuando el reclamo de garantía
-- ya se inició y las dos partes dieron conformidad.
--
-- Se miran TODAS las contrataciones del hilo, no solo la más reciente.
-- El chat sigue abierto si alguna no está cerrada o tiene reclamo abierto
-- o pendiente. Cerrar una no bloquea el hilo mientras otra del par siga viva.
--
-- Conformidad de una contratación:
--   reclamo iniciado     → claim_opened_at
--   profesional conforme → claim_marked_done_at (marcar arreglo terminado)
--   cliente conforme     → claim_resolved_at + claim_status = closed
--                          + is_claim_open = false
--                          (confirmación explícita o autoaprobación a las 72 h)
--
-- Los mensajes system siguen permitidos para el aviso de cierre.

ALTER TABLE public.contrataciones
  ADD COLUMN IF NOT EXISTS is_claim_open boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS claim_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_marked_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_resolved_at timestamptz;

COMMENT ON COLUMN public.contrataciones.claim_opened_at IS
  'Inicio del reclamo de garantía. El chat se cierra cuando todas las contrataciones del hilo están cerradas y alguna llegó a conformidad.';

CREATE OR REPLACE FUNCTION public.chat_cerrado_por_reclamo_conformidad(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.contrataciones c
      WHERE c.conversation_id = p_conversation_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.contrataciones c
      WHERE c.conversation_id = p_conversation_id
        AND (
          (
            c.estado_trabajo IS DISTINCT FROM 'finalizado'
            AND c.estado_trabajo IS DISTINCT FROM 'cancelado'
            AND c.estado_trabajo IS DISTINCT FROM 'disputa'
          )
          OR c.is_claim_open
          OR c.claim_status IN ('open', 'pending_approval')
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.contrataciones c
      WHERE c.conversation_id = p_conversation_id
        AND c.claim_opened_at IS NOT NULL
        AND c.claim_marked_done_at IS NOT NULL
        AND c.claim_resolved_at IS NOT NULL
        AND c.is_claim_open = false
        AND c.claim_status = 'closed'
    );
$$;

REVOKE ALL ON FUNCTION public.chat_cerrado_por_reclamo_conformidad(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_cerrado_por_reclamo_conformidad(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.chat_cerrado_por_reclamo_conformidad(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_message_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  block_reason TEXT;
  recent_count INT;
  blocked_pair BOOLEAN;
  image_url TEXT;
BEGIN
  -- System events (pagos, hitos, cierre de reclamo): no exigir JWT = sender
  IF coalesce(NEW.type, 'text') = 'system' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND (
          c.cliente_id = NEW.sender_id
          OR c.trabajador_id = NEW.sender_id
        )
    ) THEN
      RAISE EXCEPTION 'system_sender_not_participant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF public.chat_cerrado_por_reclamo_conformidad(NEW.conversation_id) THEN
    RAISE EXCEPTION 'chat_cerrado_por_reclamo' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'sender_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.user_blocks b ON (
      (b.blocker_id = c.cliente_id AND b.blocked_id = c.trabajador_id)
      OR (b.blocker_id = c.trabajador_id AND b.blocked_id = c.cliente_id)
    )
    WHERE c.id = NEW.conversation_id
  ) INTO blocked_pair;

  IF blocked_pair THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::int INTO recent_count
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '1 minute';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(NEW.type, 'text') = 'image' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND c.cliente_id = NEW.sender_id
    ) THEN
      RAISE EXCEPTION 'image_client_only' USING ERRCODE = 'P0001';
    END IF;

    image_url := nullif(trim(coalesce(NEW.metadata->>'image_url', '')), '');
    IF image_url IS NULL OR image_url !~* '^https?://' THEN
      RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
    END IF;

    IF char_length(coalesce(NEW.body, '')) > 2000 THEN
      RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  IF coalesce(NEW.type, 'text') <> 'text' THEN
    RETURN NEW;
  END IF;

  block_reason := public.message_body_blocked_reason(NEW.body);
  IF block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'message_blocked_contact' USING ERRCODE = 'P0001';
  END IF;

  IF char_length(coalesce(NEW.body, '')) > 2000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
