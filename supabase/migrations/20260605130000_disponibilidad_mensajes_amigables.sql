-- Mensajes de agenda más claros y amigables en el chat.

BEGIN;

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
    '📅 Te propongo estas fechas y horarios para coordinar el trabajo:' || E'\n' || trim(v_body)
      || E'\nPodés elegir la opción que mejor te quede desde el chat.'
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
    'Por ahora ninguna de estas opciones me cierra. ¿Podés proponerme otras fechas?'
  );
END;
$$;

COMMIT;
