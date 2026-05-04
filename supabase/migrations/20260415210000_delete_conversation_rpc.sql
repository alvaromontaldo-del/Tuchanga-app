-- Eliminar un chat (solo participantes). Borra mensajes/reads y luego la conversación.

CREATE OR REPLACE FUNCTION public.delete_conversation(
  p_conversation_id UUID
) RETURNS VOID AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Validar participación
  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.cliente_id = uid OR c.trabajador_id = uid)
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  -- FK ya tiene ON DELETE CASCADE en messages/reads, pero lo hacemos explícito por claridad y compat.
  DELETE FROM public.conversation_reads WHERE conversation_id = p_conversation_id;
  DELETE FROM public.messages WHERE conversation_id = p_conversation_id;
  DELETE FROM public.conversations WHERE id = p_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.delete_conversation(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_conversation(UUID) TO authenticated;

