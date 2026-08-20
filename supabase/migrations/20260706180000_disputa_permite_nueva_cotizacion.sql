-- Tras una disputa, el trabajo anterior queda cerrado para el hilo:
-- se puede enviar una nueva cotización (nueva fila en contrataciones).

DROP INDEX IF EXISTS public.ux_contrataciones_conversation_activa;

CREATE UNIQUE INDEX ux_contrataciones_conversation_activa
  ON public.contrataciones (conversation_id)
  WHERE estado_trabajo NOT IN ('finalizado', 'cancelado', 'disputa');

CREATE OR REPLACE FUNCTION public._assert_sin_contratacion_activa(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.contrataciones c
    WHERE c.conversation_id = p_conversation_id
      AND c.estado_trabajo NOT IN ('finalizado', 'cancelado', 'disputa')
  ) THEN
    RAISE EXCEPTION 'Ya existe una contratación activa en esta conversación';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_sin_contratacion_activa(uuid) FROM PUBLIC;
