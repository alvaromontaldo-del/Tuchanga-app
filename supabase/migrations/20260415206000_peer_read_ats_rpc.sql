-- Obtener read_at del "otro" participante por conversación (para tildes en lista).

CREATE OR REPLACE FUNCTION public.get_peer_read_ats(
  p_conversation_ids UUID[]
) RETURNS TABLE (
  conversation_id UUID,
  peer_read_at TIMESTAMPTZ
) AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    c.id AS conversation_id,
    cr.read_at AS peer_read_at
  FROM public.conversations c
  JOIN public.conversation_reads cr
    ON cr.conversation_id = c.id
  WHERE c.id = ANY(p_conversation_ids)
    AND (
      c.cliente_id = uid OR c.trabajador_id = uid
    )
    AND cr.user_id <> uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.get_peer_read_ats(UUID[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_peer_read_ats(UUID[]) TO authenticated;

