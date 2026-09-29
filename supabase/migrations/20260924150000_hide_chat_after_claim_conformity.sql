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
  'Inicio del reclamo de garantía. El chat se oculta cuando hubo al menos un reclamo, todos los iniciados llegaron a conformidad y ninguna contratación vinculada está en curso ni tiene reclamo abierto o pendiente.';

CREATE OR REPLACE FUNCTION public.chat_cerrado_por_reclamo_conformidad(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Misma regla que chatClosedByAllClaimsConformity en la app:
  -- hubo al menos un reclamo, todos los reclamos iniciados llegaron a
  -- conformidad de las dos partes, y ninguna contratación está en curso
  -- ni tiene reclamo abierto o pendiente.
  SELECT
    EXISTS (
      SELECT 1
      FROM public.contrataciones c
      WHERE c.conversation_id = p_conversation_id
        AND c.claim_opened_at IS NOT NULL
        AND c.claim_marked_done_at IS NOT NULL
        AND c.claim_resolved_at IS NOT NULL
        AND c.is_claim_open = false
        AND c.claim_status = 'closed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.contrataciones c
      WHERE c.conversation_id = p_conversation_id
        AND c.claim_opened_at IS NOT NULL
        AND NOT (
          c.claim_marked_done_at IS NOT NULL
          AND c.claim_resolved_at IS NOT NULL
          AND c.is_claim_open = false
          AND c.claim_status = 'closed'
        )
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
    );
$$;

REVOKE ALL ON FUNCTION public.chat_cerrado_por_reclamo_conformidad(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_cerrado_por_reclamo_conformidad(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.chat_cerrado_por_reclamo_conformidad(uuid) TO service_role;

-- enforce_message_rules ya llama a esta función en producción
-- (disable_contact_text_moderation). No se recrea acá.
