-- =============================================================================
-- Purga de imágenes de chat 15 días después de trabajo finalizado + pago total
-- =============================================================================
-- Criterio:
--   contratacion.estado_trabajo = 'finalizado'
--   contratacion.estado_pago    = 'totalmente_pagado'
--   GREATEST(finalizado_at, paid_at) <= now() - 15 days
--   y no hay contratación activa en ese conversation_id
-- Entonces: listar mensajes type='image' del hilo (todas las fotos del chat).
-- El borrado de Storage + DELETE de filas lo hace la Edge Function cleanup_chat_images
-- (service_role). Esta RPC solo lista o aplica el DELETE de mensajes tras borrar blobs.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_image_conversation
  ON public.messages (conversation_id, created_at)
  WHERE type = 'image';

CREATE OR REPLACE FUNCTION public.chat_image_storage_path(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u text := trim(coalesce(p_url, ''));
  marker text := '/storage/v1/object/public/job-photos/';
  pos int;
BEGIN
  IF u = '' THEN
    RETURN NULL;
  END IF;
  pos := strpos(u, marker);
  IF pos > 0 THEN
    RETURN nullif(substring(u from pos + length(marker)), '');
  END IF;
  -- URL firmada u otras variantes
  marker := '/object/public/job-photos/';
  pos := strpos(u, marker);
  IF pos > 0 THEN
    RETURN nullif(substring(u from pos + length(marker)), '');
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.chat_image_storage_path(text) IS
  'Extrae el path relativo dentro del bucket job-photos desde la URL pública.';

/**
 * Conversaciones elegibles: última contratación cerrada+pagada hace ≥ N días
 * y sin trabajo activo en el hilo.
 */
CREATE OR REPLACE FUNCTION public.list_expired_chat_images(
  p_retention_days integer DEFAULT 15
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  image_url text,
  storage_path text,
  closed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := GREATEST(1, coalesce(p_retention_days, 15));
BEGIN
  RETURN QUERY
  WITH closed AS (
    SELECT
      c.conversation_id,
      MAX(
        GREATEST(
          c.finalizado_at,
          coalesce(c.paid_at, c.offline_pago_confirmado_at, c.finalizado_at)
        )
      ) AS closed_at
    FROM public.contrataciones c
    WHERE c.estado_trabajo = 'finalizado'
      AND c.estado_pago = 'totalmente_pagado'
      AND c.finalizado_at IS NOT NULL
      AND c.conversation_id IS NOT NULL
    GROUP BY c.conversation_id
  ),
  eligible AS (
    SELECT cl.conversation_id, cl.closed_at
    FROM closed cl
    WHERE cl.closed_at <= (now() - make_interval(days => v_days))
      AND NOT EXISTS (
        SELECT 1
        FROM public.contrataciones a
        WHERE a.conversation_id = cl.conversation_id
          AND a.estado_trabajo NOT IN ('finalizado', 'cancelado', 'disputa')
      )
  )
  SELECT
    m.id AS message_id,
    m.conversation_id,
    nullif(trim(coalesce(m.metadata->>'image_url', '')), '') AS image_url,
    public.chat_image_storage_path(m.metadata->>'image_url') AS storage_path,
    e.closed_at
  FROM eligible e
  JOIN public.messages m
    ON m.conversation_id = e.conversation_id
   AND m.type = 'image';
END;
$$;

REVOKE ALL ON FUNCTION public.list_expired_chat_images(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_chat_images(integer) TO service_role;

/**
 * Borra filas de mensajes imagen por id (solo service_role / edge).
 */
CREATE OR REPLACE FUNCTION public.delete_chat_image_messages(
  p_message_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_message_ids IS NULL OR cardinality(p_message_ids) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.messages m
  WHERE m.id = ANY (p_message_ids)
    AND m.type = 'image';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_chat_image_messages(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_chat_image_messages(uuid[]) TO service_role;

COMMENT ON FUNCTION public.list_expired_chat_images(integer) IS
  'Lista mensajes imagen a purgar tras N días de trabajo finalizado + pago total (sin job activo).';
COMMENT ON FUNCTION public.delete_chat_image_messages(uuid[]) IS
  'Elimina mensajes type=image por id. Solo service_role.';
