-- YaChanga #206 — el profesional se entera de la disputa y puede marcar «Trabajo reparado».
--
-- Producción (kyxehrxcdealbujvvnxp), cuerpos leídos con pg_get_functiondef el 2026-10-06.
-- No se recrean hide_pair_chats_if_done, trabajador_finalizar_trabajo,
-- auto_confirmar_conformidad_vencida, marcar_arreglo_garantia_terminado ni
-- confirmar_arreglo_garantia. La garantía no se mezcla con este flujo.
--
-- cliente_responder_conformidad: mismo cuerpo live. Único agregado en el rechazo
-- (p_conforme = false): un evento de sistema con audience trabajador, con el motivo.
-- El evento del cliente queda igual (audience cliente). El conforme sigue en
-- finalizado + hide_pair_chats_if_done (#84). Los GRANT de esta función no se tocan
-- (authenticated y service_role; anon no tiene EXECUTE).
--
-- trabajador_marcar_trabajo_reparado (nueva): solo el profesional, solo desde
-- disputa. Vuelve a pendiente_conformidad, pide conformidad de nuevo y reinicia
-- el reloj de 72 h (#115) limpiando la respuesta y los recordatorios. Conserva
-- disputa_motivo para mostrar el contexto del arreglo. No oculta el chat: eso
-- ocurre cuando el cliente (o las 72 h) acepta y corre el path de conformidad
-- ya existente. Un segundo «no conforme» vuelve a disputa con esta misma función
-- de respuesta.
--
-- anon no recibe EXECUTE de la función nueva.

BEGIN;

CREATE OR REPLACE FUNCTION public.cliente_responder_conformidad(
  p_contratacion_id uuid,
  p_conforme boolean,
  p_motivo_disputa text DEFAULT ''::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_motivo text;
  v_aviso_pro text;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede responder conformidad';
  END IF;

  IF v_row.estado_trabajo <> 'pendiente_conformidad' THEN
    RAISE EXCEPTION 'Estado inválido para responder conformidad';
  END IF;

  IF v_row.conformidad_solicitada_at IS NULL THEN
    RAISE EXCEPTION 'El trabajador aún no solicitó conformidad';
  END IF;

  IF v_row.conformidad_respondida_at IS NOT NULL THEN
    RAISE EXCEPTION 'La conformidad ya fue respondida';
  END IF;

  IF p_conforme THEN
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'finalizado',
      finalizado_at = now(),
      completed_by_worker_at = coalesce(completed_by_worker_at, now()),
      conformidad_respondida_at = now(),
      conformidad_aceptada = true
    WHERE id = p_contratacion_id;

    PERFORM public.hide_pair_chats_if_done(v_row.client_id, v_row.worker_id);

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      '✅ Confirmaste que el trabajo fue realizado correctamente. ¡Gracias! Podés dejar tu reseña.',
      jsonb_build_object(
        'event', 'conformidad_aceptada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );
  ELSE
    v_motivo := coalesce(trim(p_motivo_disputa), '');

    UPDATE public.contrataciones
    SET
      estado_trabajo = 'disputa',
      disputa_motivo = v_motivo,
      conformidad_respondida_at = now(),
      conformidad_aceptada = false
    WHERE id = p_contratacion_id;

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      'Indicaste un problema con el trabajo. Quedó en disputa y el chat sigue disponible. El saldo, si corresponde, se paga directo al profesional, fuera de la app.',
      jsonb_build_object(
        'event', 'conformidad_rechazada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );

    v_aviso_pro := 'El cliente marcó el trabajo como no conforme.';
    IF v_motivo <> '' THEN
      v_aviso_pro := v_aviso_pro || ' Motivo: ' || left(v_motivo, 600) || '.';
    END IF;
    v_aviso_pro := v_aviso_pro
      || ' El trabajo quedó en disputa: reparalo y marcá «Trabajo reparado».';

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      v_aviso_pro,
      jsonb_build_object(
        'event', 'disputa_abierta',
        'contratacion_id', p_contratacion_id,
        'audience', 'trabajador'
      )
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trabajador_marcar_trabajo_reparado(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_n integer;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede marcar el trabajo como reparado';
  END IF;

  IF v_row.estado_trabajo <> 'disputa' THEN
    RAISE EXCEPTION 'Estado inválido para marcar el trabajo como reparado';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_trabajo = 'pendiente_conformidad',
    conformidad_solicitada_at = now(),
    conformidad_aceptada = NULL,
    conformidad_respondida_at = NULL,
    conformidad_automatica = false,
    conformidad_recordatorio_24h_at = NULL,
    conformidad_recordatorio_48h_at = NULL
  WHERE id = p_contratacion_id
    AND estado_trabajo = 'disputa'
    AND worker_id = auth.uid();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Estado inválido para marcar el trabajo como reparado';
  END IF;

  IF v_row.conversation_id IS NOT NULL THEN
    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.worker_id,
      'El profesional marcó el trabajo como reparado. ¿Quedó bien ahora? Confirmá o indicá que tuviste un problema. Si no respondés en 72 h, lo damos por conforme.',
      jsonb_build_object(
        'event', 'conformidad_solicitada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.worker_id,
      'Marcaste el trabajo como reparado. Esperamos la conformidad del cliente. Si no responde en 72 h, se confirma solo.',
      jsonb_build_object(
        'event', 'trabajo_reparado',
        'contratacion_id', p_contratacion_id,
        'audience', 'trabajador'
      )
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.trabajador_marcar_trabajo_reparado(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trabajador_marcar_trabajo_reparado(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.trabajador_marcar_trabajo_reparado(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.trabajador_marcar_trabajo_reparado(uuid) IS
  '#206: el profesional marca reparado un trabajo en disputa. Vuelve a pendiente_conformidad para que el cliente confirme otra vez. No cierra el chat ni toca la garantía.';

COMMIT;
