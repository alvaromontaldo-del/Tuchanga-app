-- Ocultar conversaciones por usuario (tipo WhatsApp: "eliminar" solo para mí).

CREATE TABLE IF NOT EXISTS public.conversation_hides (
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_hides_user ON public.conversation_hides (user_id);
CREATE INDEX IF NOT EXISTS idx_conv_hides_conv ON public.conversation_hides (conversation_id);

ALTER TABLE public.conversation_hides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_hides_select_own" ON public.conversation_hides;
CREATE POLICY "conv_hides_select_own" ON public.conversation_hides
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "conv_hides_insert_own" ON public.conversation_hides;
CREATE POLICY "conv_hides_insert_own" ON public.conversation_hides
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "conv_hides_update_own" ON public.conversation_hides;
CREATE POLICY "conv_hides_update_own" ON public.conversation_hides
FOR UPDATE TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "conv_hides_delete_own" ON public.conversation_hides;
CREATE POLICY "conv_hides_delete_own" ON public.conversation_hides
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- RPC: ocultar conversación para el usuario actual y marcar leído al instante
CREATE OR REPLACE FUNCTION public.hide_conversation(
  p_conversation_id UUID
) RETURNS VOID AS $$
DECLARE
  uid UUID := auth.uid();
  ts TIMESTAMPTZ := now();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (c.cliente_id = uid OR c.trabajador_id = uid)
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
  VALUES (p_conversation_id, uid, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET hidden_at = EXCLUDED.hidden_at;

  -- Para que el badge se vaya a 0 inmediatamente
  INSERT INTO public.conversation_reads (conversation_id, user_id, read_at)
  VALUES (p_conversation_id, uid, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET read_at = EXCLUDED.read_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.hide_conversation(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.hide_conversation(UUID) TO authenticated;

