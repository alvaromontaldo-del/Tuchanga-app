-- Card #43. El profesional no puede proponer un turno que se pisa con su agenda.
--
-- NO EJECUTADO. Aplicar a mano en el SQL editor de Supabase y diffear contra
-- producción (kyxehrxcdealbujvvnxp) antes de dejarlo.
--
-- Función viva que este archivo RECREA (CREATE OR REPLACE):
--   public.proponer_disponibilidad_opciones(uuid, jsonb)
--
-- Base: pg_get_functiondef de producción del 2026-10-02. La copia del repo
-- (supabase/migrations/20260617120000_chat_milestones_conformidad.sql) está
-- atrás: no tiene la rama de garantía (estado finalizado + reclamo abierto).
-- El diff contra producción tiene que mostrar solo el bloque marcado #43
-- (lock + chequeo de solape antes del INSERT). El resto del cuerpo, el mensaje
-- de chat y la rama de garantía quedan iguales.
--
-- Función NUEVA (no existe en producción):
--   public._agenda_conflicting_busy_slot(uuid, uuid, date, time, time)
--
-- No se recrean: proponer_disponibilidad(uuid, date, time, time) — sigue
-- delegando en proponer_disponibilidad_opciones —, aceptar_disponibilidad,
-- aceptar_disponibilidad_opcion, proponer_reagendar_visita,
-- aceptar_reagendar_visita, rechazar_*, _agenda_slot_overlaps,
-- _agenda_lock_worker, _agenda_ensure_reserved, _agenda_free_blocks,
-- calc_yachanga_service_fee ni ninguna función de chat, push, cotización o pago.
--
-- Ocupado («ocupado»):
--   * contrataciones.estado_trabajo IN ('aceptado', 'en_curso')
--     — confirmado / aceptado y en curso — con fecha y hora de inicio.
--   * disponibilidad_opciones.estado = 'propuesta' de OTRO trabajo cuyo
--     estado_trabajo está en ('precio_aceptado', 'aceptado', 'en_curso')
--     — pendiente de aceptación del cliente, incluida una propuesta de
--     reagendado que todavía no se aprobó.
-- No ocupan: cancelado, finalizado, disputa, pendiente_conformidad,
-- pendiente_pago_diferencia, pendiente, precio_cotizado, ni opciones
-- descartada / aceptada (la aceptada ya está reflejada en el trabajo).
--
-- Solape: start < other_end AND end > other_start, en America/Buenos_Aires.
-- Sin hora de fin (o fin <= inicio) se suman 60 minutos, igual que el
-- formulario. El contacto exacto (uno termina cuando el otro empieza) no pisa.
-- Se excluye la contratación actual: reenviar o editar el mismo turno del
-- mismo trabajo no se bloquea. El RAISE hace rollback, así que las propuestas
-- anteriores de ese trabajo vuelven a quedar en 'propuesta'.
--
-- Código de error: mensaje 'slot_overlap' (SQLSTATE P0001) y DETAIL
-- fecha=YYYY-MM-DD;hora_inicio=HH24:MI;hora_fin=HH24:MI;opcion_index=N
-- (N es el índice 0-based del array enviado). La app lo traduce a
-- «Ya tenés agendado un trabajo el {día} de {hh:mm} a {hh:mm}. Elegí otro día u horario.»
--
-- Depende de funciones que ya están en producción y NO se redefinen acá:
--   _agenda_lock_worker(uuid), _assert_contratacion_participante(uuid),
--   _chat_insert_system_event(uuid, uuid, text, jsonb).

CREATE OR REPLACE FUNCTION public._agenda_conflicting_busy_slot(
  p_worker_id uuid,
  p_exclude_contratacion_id uuid,
  p_fecha date,
  p_ini time,
  p_fin time
)
RETURNS TABLE (
  fecha_trabajo date,
  hora_inicio text,
  hora_fin text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF p_worker_id IS NULL OR p_fecha IS NULL OR p_ini IS NULL THEN
    RETURN;
  END IF;

  v_start := (p_fecha + p_ini) AT TIME ZONE 'America/Buenos_Aires';
  IF p_fin IS NOT NULL AND p_fin > p_ini THEN
    v_end := (p_fecha + p_fin) AT TIME ZONE 'America/Buenos_Aires';
  ELSE
    v_end := v_start + interval '60 minutes';
  END IF;

  RETURN QUERY
  WITH busy AS (
    SELECT
      c.fecha_trabajo AS fecha,
      (c.fecha_trabajo + c.hora_inicio) AT TIME ZONE 'America/Buenos_Aires' AS start_at,
      CASE
        WHEN c.hora_fin IS NOT NULL AND c.hora_fin > c.hora_inicio
          THEN (c.fecha_trabajo + c.hora_fin) AT TIME ZONE 'America/Buenos_Aires'
        ELSE ((c.fecha_trabajo + c.hora_inicio) AT TIME ZONE 'America/Buenos_Aires')
          + interval '60 minutes'
      END AS end_at
    FROM public.contrataciones c
    WHERE c.worker_id = p_worker_id
      AND c.id IS DISTINCT FROM p_exclude_contratacion_id
      AND c.estado_trabajo IN ('aceptado', 'en_curso')
      AND c.fecha_trabajo IS NOT NULL
      AND c.hora_inicio IS NOT NULL

    UNION ALL

    SELECT
      o.fecha_trabajo AS fecha,
      (o.fecha_trabajo + o.hora_inicio) AT TIME ZONE 'America/Buenos_Aires' AS start_at,
      CASE
        WHEN o.hora_fin IS NOT NULL AND o.hora_fin > o.hora_inicio
          THEN (o.fecha_trabajo + o.hora_fin) AT TIME ZONE 'America/Buenos_Aires'
        ELSE ((o.fecha_trabajo + o.hora_inicio) AT TIME ZONE 'America/Buenos_Aires')
          + interval '60 minutes'
      END AS end_at
    FROM public.disponibilidad_opciones o
    JOIN public.contrataciones c ON c.id = o.contratacion_id
    WHERE c.worker_id = p_worker_id
      AND c.id IS DISTINCT FROM p_exclude_contratacion_id
      AND o.estado = 'propuesta'
      AND c.estado_trabajo IN ('precio_aceptado', 'aceptado', 'en_curso')
      AND o.fecha_trabajo IS NOT NULL
      AND o.hora_inicio IS NOT NULL
  )
  SELECT
    b.fecha,
    to_char(b.start_at AT TIME ZONE 'America/Buenos_Aires', 'HH24:MI'),
    to_char(b.end_at AT TIME ZONE 'America/Buenos_Aires', 'HH24:MI')
  FROM busy b
  WHERE b.start_at < v_end
    AND b.end_at > v_start
  ORDER BY b.start_at
  LIMIT 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public._agenda_conflicting_busy_slot(uuid, uuid, date, time, time)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._agenda_conflicting_busy_slot(uuid, uuid, date, time, time)
  TO service_role;

-- Cuerpo = producción 2026-10-02 + bloque #43.
CREATE OR REPLACE FUNCTION public.proponer_disponibilidad_opciones(
  p_contratacion_id uuid,
  p_opciones jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  v_claim boolean := false;
  v_conf_fecha date;
  v_conf_ini text;
  v_conf_fin text;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede proponer disponibilidad';
  END IF;

  v_claim := (
    v_row.estado_trabajo = 'finalizado'
    AND v_row.is_claim_open
    AND v_row.claim_status IN ('open', 'pending_approval')
  );

  IF v_row.estado_trabajo <> 'precio_aceptado' AND NOT v_claim THEN
    RAISE EXCEPTION 'Estado inválido para proponer disponibilidad';
  END IF;

  IF p_opciones IS NULL OR jsonb_typeof(p_opciones) <> 'array' THEN
    RAISE EXCEPTION 'Opciones inválidas';
  END IF;

  v_count := jsonb_array_length(p_opciones);
  IF v_count < 1 OR v_count > 5 THEN
    RAISE EXCEPTION 'Debés enviar entre 1 y 5 opciones';
  END IF;

  -- #43. Misma llave que _agenda_lock_worker: serializa con aceptar y reagendar.
  PERFORM public._agenda_lock_worker(v_row.worker_id);

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

    -- #43. Antes del INSERT. Si falla, el UPDATE de arriba hace rollback.
    SELECT s.fecha_trabajo, s.hora_inicio, s.hora_fin
    INTO v_conf_fecha, v_conf_ini, v_conf_fin
    FROM public._agenda_conflicting_busy_slot(
      v_row.worker_id,
      p_contratacion_id,
      v_fecha,
      v_ini,
      v_fin
    ) AS s;

    IF v_conf_fecha IS NOT NULL THEN
      RAISE EXCEPTION 'slot_overlap'
        USING
          ERRCODE = 'P0001',
          DETAIL = format(
            'fecha=%s;hora_inicio=%s;hora_fin=%s;opcion_index=%s',
            to_char(v_conf_fecha, 'YYYY-MM-DD'),
            v_conf_ini,
            v_conf_fin,
            v_n
          );
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

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    CASE
      WHEN v_claim THEN
        '📅 (Garantía) Propongo estos horarios para la revisión:' || E'\n' || trim(v_body)
      ELSE
        '📅 Propongo estos horarios (elegí uno o rechazá todos):' || E'\n' || trim(v_body)
    END,
    jsonb_build_object(
      'event', 'disponibilidad_propuesta',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente',
      'lote', v_lote,
      'opciones_count', v_count
    )
  );
END;
$fn$;
