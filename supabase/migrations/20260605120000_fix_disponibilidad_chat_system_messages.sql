-- Los avisos automáticos de contratación incluyen fechas/horas (ej. 23/06/2026 17:16)
-- y el trigger anti-contacto los bloquea por exceso de dígitos.
-- Solución: tipo de mensaje 'system' (no moderado como texto libre).

BEGIN;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'budget', 'quotation', 'system'));

CREATE OR REPLACE FUNCTION public._chat_notify_contratacion(
  p_conversation_id uuid,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, body, type)
  VALUES (p_conversation_id, auth.uid(), left(trim(p_body), 2000), 'system');
END;
$$;

COMMIT;
