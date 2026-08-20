-- YaChanga — Hitos en chat (system + metadata), estado pendiente_conformidad
-- Paso 1: mensajes automáticos + flujo de conformidad en BD.

-- El nuevo valor de enum no puede usarse en la misma transacción que ADD VALUE (PG).
ALTER TYPE public.contratacion_estado_trabajo
  ADD VALUE IF NOT EXISTS 'pendiente_conformidad';

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Columnas de conformidad
-- ---------------------------------------------------------------------------

ALTER TABLE public.contrataciones
  ADD COLUMN IF NOT EXISTS conformidad_respondida_at timestamptz,
  ADD COLUMN IF NOT EXISTS conformidad_aceptada boolean;

-- ---------------------------------------------------------------------------
-- 2) Helper: mensajes system con metadata (auth + service_role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._chat_insert_system_event(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_body text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt() ->> 'role',
    ''
  );

  IF v_role <> 'service_role' AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_conversation_id IS NULL OR p_sender_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id y sender_id requeridos';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
  VALUES (
    p_conversation_id,
    p_sender_id,
    left(trim(coalesce(p_body, '')), 2000),
    'system',
    coalesce(p_metadata, '{}'::jsonb)
  );
END;
$$;

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

  PERFORM public._chat_insert_system_event(
    p_conversation_id,
    auth.uid(),
    p_body,
    '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public._chat_insert_system_event(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._chat_insert_system_event(uuid, uuid, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Disponibilidad → mensaje interactivo en chat (metadata)
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

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    '📅 Te propongo estas fechas y horarios para coordinar el trabajo:' || E'\n' || trim(v_body)
      || E'\n\nElegí la opción que mejor te quede.',
    jsonb_build_object(
      'event', 'disponibilidad_propuesta',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente',
      'lote', v_lote,
      'opciones_count', v_count
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

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    v_body,
    jsonb_build_object(
      'event', 'horario_confirmado',
      'contratacion_id', v_opc.contratacion_id,
      'audience', 'todos',
      'opcion_id', p_opcion_id
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Seña pagada → avisos cliente + trabajador (webhook / service_role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_seña_aprobada(
  p_contratacion_id uuid,
  p_tipo_pago public.transaccion_tipo_pago,
  p_monto numeric,
  p_mp_payment_id text,
  p_mp_preference_id text,
  p_idempotency_key text,
  p_external_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_was_pending boolean;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role';
  END IF;

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contratación inexistente';
  END IF;

  v_was_pending := v_row.estado_pago = 'pendiente_seña';

  INSERT INTO public.transacciones_pago (
    contratacion_id,
    cliente_id,
    tipo_pago,
    monto,
    estado_mp,
    mp_payment_id,
    mp_preference_id,
    idempotency_key,
    external_reference
  )
  VALUES (
    p_contratacion_id,
    v_row.client_id,
    p_tipo_pago,
    p_monto,
    'approved',
    p_mp_payment_id,
    p_mp_preference_id,
    p_idempotency_key,
    p_external_reference
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF v_was_pending THEN
    UPDATE public.contrataciones
    SET
      estado_pago = 'seña_pagada',
      seña_pagada_at = now(),
      verification_pin = coalesce(verification_pin, public.generar_pin_verificacion()),
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL,
      recotizacion_precio_trabajador = NULL,
      recotizacion_precio_final = NULL,
      recotizacion_comision_app = NULL,
      estado_trabajo = CASE
        WHEN estado_trabajo = 'pendiente_pago_diferencia' THEN 'en_curso'
        ELSE estado_trabajo
      END
    WHERE id = p_contratacion_id;

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      '✅ Seña pagada correctamente.' || E'\n\n'
        || 'Tu PIN de seguridad ha sido generado. Por motivos de seguridad, dáselo al trabajador '
        || 'únicamente cuando llegue a tu domicilio.' || E'\n\n'
        || 'La dirección de tu domicilio ha sido compartida con el trabajador para que pueda asistir.',
      jsonb_build_object(
        'event', 'seña_pagada_cliente',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.worker_id,
      '¡Seña pagada! Al llegar al domicilio, recordá pedirle el PIN de seguridad al cliente '
        || 'para iniciar el trabajo.',
      jsonb_build_object(
        'event', 'seña_pagada_trabajador',
        'contratacion_id', p_contratacion_id,
        'audience', 'trabajador'
      )
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) PIN validado → aviso al cliente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verificar_pin(
  p_contratacion_id uuid,
  p_pin_ingresado text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_ok boolean;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede verificar el PIN';
  END IF;

  IF v_row.estado_trabajo <> 'aceptado' OR v_row.estado_pago <> 'seña_pagada' THEN
    RAISE EXCEPTION 'Estado inválido para verificar PIN';
  END IF;

  IF v_row.pin_bloqueado_hasta IS NOT NULL AND v_row.pin_bloqueado_hasta > now() THEN
    RAISE EXCEPTION 'PIN bloqueado temporalmente';
  END IF;

  v_ok := v_row.verification_pin IS NOT NULL
    AND lpad(trim(coalesce(p_pin_ingresado, '')), 4, '0') = v_row.verification_pin;

  INSERT INTO public.pin_intentos (contratacion_id, actor_id, pin_ingresado, exito)
  VALUES (p_contratacion_id, auth.uid(), coalesce(p_pin_ingresado, ''), v_ok);

  IF v_ok THEN
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'en_curso',
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL
    WHERE id = p_contratacion_id;

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.worker_id,
      'El trabajador ha validado el PIN. El trabajo ha pasado a estado: En curso.',
      jsonb_build_object(
        'event', 'pin_validado',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );

    RETURN true;
  END IF;

  UPDATE public.contrataciones
  SET
    pin_intentos_fallidos = pin_intentos_fallidos + 1,
    pin_bloqueado_hasta = CASE
      WHEN pin_intentos_fallidos + 1 >= 5 THEN now() + interval '15 minutes'
      ELSE pin_bloqueado_hasta
    END
  WHERE id = p_contratacion_id;

  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Finalizar trabajo → pendiente_conformidad + aviso al cliente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trabajador_finalizar_trabajo(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede finalizar';
  END IF;

  IF v_row.estado_trabajo <> 'en_curso' THEN
    RAISE EXCEPTION 'Estado inválido para finalizar';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_trabajo = 'pendiente_conformidad',
    conformidad_solicitada_at = now(),
    completed_by_worker_at = now()
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El trabajador ha dado por finalizado el trabajo. ¿El trabajo se realizó correctamente?',
    jsonb_build_object(
      'event', 'conformidad_solicitada',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Respuesta de conformidad del cliente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cliente_responder_conformidad(
  p_contratacion_id uuid,
  p_conforme boolean,
  p_motivo_disputa text DEFAULT ''
)
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

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      '✅ Confirmaste que el trabajo fue realizado correctamente. ¡Gracias! Podés dejar tu reseña.',
      jsonb_build_object(
        'event', 'conformidad_aceptada',
        'contratacion_id', p_contratacion_id,
        'audience', 'todos'
      )
    );
  ELSE
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'disputa',
      disputa_motivo = coalesce(trim(p_motivo_disputa), ''),
      conformidad_respondida_at = now(),
      conformidad_aceptada = false
    WHERE id = p_contratacion_id;

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      'Indicaste que el trabajo no fue conforme. Podés cargar un reclamo en "Tuve un problema". '
        || 'Si preferís, también podés dejar una reseña.',
      jsonb_build_object(
        'event', 'conformidad_rechazada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );
  END IF;
END;
$$;

COMMIT;
