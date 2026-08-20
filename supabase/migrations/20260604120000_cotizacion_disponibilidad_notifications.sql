-- Notificaciones en chat al aceptar/rechazar presupuesto + disponibilidad (hasta 5 opciones)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tabla de opciones de disponibilidad
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.disponibilidad_opciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratacion_id uuid NOT NULL REFERENCES public.contrataciones (id) ON DELETE CASCADE,
  lote int NOT NULL DEFAULT 1,
  fecha_trabajo date NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  estado text NOT NULL DEFAULT 'propuesta'
    CHECK (estado IN ('propuesta', 'aceptada', 'descartada')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disponibilidad_horario_valido CHECK (hora_fin > hora_inicio)
);

CREATE INDEX IF NOT EXISTS idx_disp_opc_contratacion
  ON public.disponibilidad_opciones (contratacion_id, lote DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disp_opc_propuesta
  ON public.disponibilidad_opciones (contratacion_id)
  WHERE estado = 'propuesta';

ALTER TABLE public.disponibilidad_opciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS disp_opc_select_participants ON public.disponibilidad_opciones;
CREATE POLICY disp_opc_select_participants
ON public.disponibilidad_opciones
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.contrataciones c
    WHERE c.id = contratacion_id
      AND (c.client_id = auth.uid() OR c.worker_id = auth.uid())
  )
);

GRANT SELECT ON TABLE public.disponibilidad_opciones TO authenticated, service_role;
GRANT ALL ON TABLE public.disponibilidad_opciones TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Helper: mensaje en el chat de la contratación
-- ---------------------------------------------------------------------------

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
  VALUES (p_conversation_id, auth.uid(), left(trim(p_body), 2000), 'text');
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Aceptar / rechazar precio → aviso en chat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aceptar_precio_cotizado(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede aceptar el precio';
  END IF;

  IF v_row.estado_trabajo <> 'precio_cotizado' THEN
    RAISE EXCEPTION 'Estado inválido para aceptar precio';
  END IF;

  UPDATE public.contrataciones
  SET estado_trabajo = 'precio_aceptado'
  WHERE id = p_contratacion_id;

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '✅ Acepté el presupuesto. Profesional: enviá hasta 5 opciones de día y horario para coordinar la visita.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_precio_cotizado(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede rechazar el precio';
  END IF;

  IF v_row.estado_trabajo <> 'precio_cotizado' THEN
    RAISE EXCEPTION 'Estado inválido para rechazar precio';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_trabajo = 'cancelado',
    cancelado_at = now()
  WHERE id = p_contratacion_id;

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '❌ Rechacé el presupuesto.'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Disponibilidad: hasta 5 opciones por lote
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.proponer_disponibilidad_opciones(
  p_contratacion_id uuid,
  p_opciones jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_count int;
  v_lote int;
  v_opcion jsonb;
  v_fecha date;
  v_ini time;
  v_fin time;
  v_body text := '';
  v_n int := 0;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede proponer disponibilidad';
  END IF;

  IF v_row.estado_trabajo <> 'precio_aceptado' THEN
    RAISE EXCEPTION 'Estado inválido para proponer disponibilidad';
  END IF;

  IF p_opciones IS NULL OR jsonb_typeof(p_opciones) <> 'array' THEN
    RAISE EXCEPTION 'Opciones inválidas';
  END IF;

  v_count := jsonb_array_length(p_opciones);
  IF v_count < 1 OR v_count > 5 THEN
    RAISE EXCEPTION 'Debés enviar entre 1 y 5 opciones';
  END IF;

  UPDATE public.disponibilidad_opciones
  SET estado = 'descartada'
  WHERE contratacion_id = p_contratacion_id
    AND estado = 'propuesta';

  SELECT coalesce(max(lote), 0) + 1 INTO v_lote
  FROM public.disponibilidad_opciones
  WHERE contratacion_id = p_contratacion_id;

  FOR v_opcion IN SELECT value FROM jsonb_array_elements(p_opciones)
  LOOP
    v_fecha := (v_opcion->>'fecha')::date;
    v_ini := (v_opcion->>'hora_inicio')::time;
    v_fin := (v_opcion->>'hora_fin')::time;

    IF v_fecha IS NULL OR v_ini IS NULL OR v_fin IS NULL OR v_fin <= v_ini THEN
      RAISE EXCEPTION 'Cada opción debe tener fecha y horario válidos';
    END IF;

    INSERT INTO public.disponibilidad_opciones (
      contratacion_id, lote, fecha_trabajo, hora_inicio, hora_fin, estado
    )
    VALUES (p_contratacion_id, v_lote, v_fecha, v_ini, v_fin, 'propuesta');

    v_n := v_n + 1;
    v_body := v_body || v_n::text || ') '
      || to_char(v_fecha, 'DD/MM/YYYY') || ' '
      || to_char(v_ini, 'HH24:MI') || '–' || to_char(v_fin, 'HH24:MI') || E'\n';
  END LOOP;

  UPDATE public.contrataciones
  SET
    fecha_trabajo = NULL,
    hora_inicio = NULL,
    hora_fin = NULL
  WHERE id = p_contratacion_id;

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '📅 Propongo estos horarios (elegí uno o rechazá todos):' || E'\n' || trim(v_body)
  );
END;
$$;

-- Compat: una sola opción (flujo anterior)
CREATE OR REPLACE FUNCTION public.proponer_disponibilidad(
  p_contratacion_id uuid,
  p_fecha_trabajo date,
  p_hora_inicio time,
  p_hora_fin time
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.proponer_disponibilidad_opciones(
    p_contratacion_id,
    jsonb_build_array(
      jsonb_build_object(
        'fecha', p_fecha_trabajo::text,
        'hora_inicio', p_hora_inicio::text,
        'hora_fin', p_hora_fin::text
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aceptar_disponibilidad_opcion(p_opcion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opc public.disponibilidad_opciones%rowtype;
  v_row public.contrataciones%rowtype;
  v_body text;
BEGIN
  SELECT * INTO v_opc
  FROM public.disponibilidad_opciones
  WHERE id = p_opcion_id;

  IF NOT FOUND OR v_opc.estado <> 'propuesta' THEN
    RAISE EXCEPTION 'Opción no disponible';
  END IF;

  v_row := public._assert_contratacion_participante(v_opc.contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede aceptar la disponibilidad';
  END IF;

  IF v_row.estado_trabajo <> 'precio_aceptado' THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.disponibilidad_opciones
  SET estado = 'descartada'
  WHERE contratacion_id = v_opc.contratacion_id
    AND estado = 'propuesta'
    AND id <> p_opcion_id;

  UPDATE public.disponibilidad_opciones
  SET estado = 'aceptada'
  WHERE id = p_opcion_id;

  UPDATE public.contrataciones
  SET
    fecha_trabajo = v_opc.fecha_trabajo,
    hora_inicio = v_opc.hora_inicio,
    hora_fin = v_opc.hora_fin,
    estado_trabajo = 'aceptado'
  WHERE id = v_opc.contratacion_id;

  v_body := '✅ Confirmé el horario: '
    || to_char(v_opc.fecha_trabajo, 'DD/MM/YYYY') || ' '
    || to_char(v_opc.hora_inicio, 'HH24:MI') || '–' || to_char(v_opc.hora_fin, 'HH24:MI');

  PERFORM public._chat_notify_contratacion(v_row.conversation_id, v_body);
END;
$$;

CREATE OR REPLACE FUNCTION public.aceptar_disponibilidad(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_opcion_id uuid;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  SELECT id INTO v_opcion_id
  FROM public.disponibilidad_opciones
  WHERE contratacion_id = p_contratacion_id
    AND estado = 'propuesta'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_opcion_id IS NOT NULL THEN
    PERFORM public.aceptar_disponibilidad_opcion(v_opcion_id);
    RETURN;
  END IF;

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede aceptar la disponibilidad';
  END IF;

  IF v_row.estado_trabajo <> 'precio_aceptado' THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  IF v_row.fecha_trabajo IS NULL THEN
    RAISE EXCEPTION 'Aún no hay agenda propuesta';
  END IF;

  UPDATE public.contrataciones
  SET estado_trabajo = 'aceptado'
  WHERE id = p_contratacion_id;

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '✅ Confirmé el horario propuesto.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_disponibilidad(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede rechazar la disponibilidad';
  END IF;

  IF v_row.estado_trabajo <> 'precio_aceptado' THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.disponibilidad_opciones
  SET estado = 'descartada'
  WHERE contratacion_id = p_contratacion_id
    AND estado = 'propuesta';

  UPDATE public.contrataciones
  SET
    fecha_trabajo = NULL,
    hora_inicio = NULL,
    hora_fin = NULL
  WHERE id = p_contratacion_id;

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '❌ Ningún horario me sirve. Profesional: enviá otras opciones (hasta 5).'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) GRANTs
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public._chat_notify_contratacion(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._chat_notify_contratacion(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.proponer_disponibilidad_opciones(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proponer_disponibilidad_opciones(uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.aceptar_disponibilidad_opcion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aceptar_disponibilidad_opcion(uuid) TO authenticated, service_role;

COMMIT;
