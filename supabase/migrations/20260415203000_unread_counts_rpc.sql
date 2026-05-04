-- Conteo exacto de no leídos por conversación (tipo WhatsApp).
-- Requiere public.conversation_reads (ver 20260415200000_jobs_photo_urls_and_reads.sql).

CREATE OR REPLACE FUNCTION public.get_unread_counts(
  p_conversation_ids UUID[]
) RETURNS TABLE (
  conversation_id UUID,
  unread_count INTEGER
) AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  WITH reads AS (
    SELECT cr.conversation_id, cr.read_at
    FROM public.conversation_reads cr
    WHERE cr.user_id = uid
      AND cr.conversation_id = ANY(p_conversation_ids)
  )
  SELECT
    m.conversation_id,
    COUNT(*)::int AS unread_count
  FROM public.messages m
  LEFT JOIN reads r ON r.conversation_id = m.conversation_id
  WHERE m.conversation_id = ANY(p_conversation_ids)
    AND m.sender_id <> uid
    AND m.created_at > COALESCE(r.read_at, '1970-01-01'::timestamptz)
  GROUP BY m.conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.get_unread_counts(UUID[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_unread_counts(UUID[]) TO authenticated;

