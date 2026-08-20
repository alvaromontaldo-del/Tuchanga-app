-- Mensajes de imagen en chat (cliente → trabajador).
-- type 'image' + metadata.image_url; solo el cliente del hilo puede insertarlos.

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'budget', 'quotation', 'system', 'image'));

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
  IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'sender_mismatch' USING ERRCODE = '42501';
  END IF;

  -- Bloqueo entre participantes del hilo
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

  -- Rate limit: máx. 30 mensajes por minuto por usuario
  SELECT COUNT(*)::int INTO recent_count
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '1 minute';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- Imágenes: solo el cliente del hilo; requiere URL pública en metadata
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

  -- Presupuestos / metadatos estructurados: no moderar cuerpo vacío o tipo budget
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
