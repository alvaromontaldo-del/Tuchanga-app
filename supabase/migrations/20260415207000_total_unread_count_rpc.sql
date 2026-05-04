-- Conteo total de mensajes no leídos (badge global en tab "Mensajes").

CREATE OR REPLACE FUNCTION public.get_total_unread_count()
RETURNS INTEGER AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN (
    WITH my_convs AS (
      SELECT id
      FROM public.conversations
      WHERE cliente_id = uid OR trabajador_id = uid
    ),
    reads AS (
      SELECT conversation_id, read_at
      FROM public.conversation_reads
      WHERE user_id = uid
    )
    SELECT COUNT(*)::int
    FROM public.messages m
    JOIN my_convs c ON c.id = m.conversation_id
    LEFT JOIN reads r ON r.conversation_id = m.conversation_id
    WHERE m.sender_id <> uid
      AND m.created_at > COALESCE(r.read_at, '1970-01-01'::timestamptz)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.get_total_unread_count() FROM public;
GRANT EXECUTE ON FUNCTION public.get_total_unread_count() TO authenticated;

