-- #71 / #72 / #75
-- Textos que ve el usuario: «Costo de servicio YaChanga», nunca «seña».
-- Los enums (seña_pagada, pendiente_seña, seña_inicial) no cambian.
-- Finalizar pide conformidad al cliente. La conformidad positiva sigue cerrando
-- el trabajo y, si el pago está completo, oculta el chat. Un problema deja
-- disputa y el chat sigue visible. No abre el reclamo de garantía.

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

    BEGIN
      PERFORM public._chat_insert_system_event(
        v_row.conversation_id,
        v_row.client_id,
        '✅ Costo de servicio YaChanga pagado.' || E'\n\n'
          || 'Tu PIN de seguridad fue generado. Por seguridad, dáselo al profesional '
          || 'únicamente cuando llegue a tu domicilio.' || E'\n\n'
          || 'La dirección de tu domicilio se compartió con el profesional para que pueda asistir.' || E'\n\n'
          || 'El saldo restante del trabajo se paga directo al profesional, fuera de la app. No genera comprobante de Mercado Pago.',
        jsonb_build_object(
          'event', 'seña_pagada_cliente',
          'contratacion_id', p_contratacion_id,
          'audience', 'cliente'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'registrar_seña chat cliente: %', SQLERRM;
    END;

    BEGIN
      PERFORM public._chat_insert_system_event(
        v_row.conversation_id,
        v_row.worker_id,
        'El costo de servicio YaChanga fue pagado. Al llegar al domicilio, pedile el PIN al cliente. El saldo restante te lo paga el cliente directo, fuera de la app.',
        jsonb_build_object(
          'event', 'seña_pagada_trabajador',
          'contratacion_id', p_contratacion_id,
          'audience', 'trabajador'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'registrar_seña chat trabajador: %', SQLERRM;
    END;
  END IF;
END;
$$;

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
    completed_by_worker_at = now(),
    conformidad_aceptada = NULL,
    conformidad_respondida_at = NULL
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional marcó el trabajo como finalizado. ¿Quedó bien? Confirmá o indicá que tuviste un problema.',
    jsonb_build_object(
      'event', 'conformidad_solicitada',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Marcaste el trabajo como finalizado. Esperamos la conformidad del cliente.',
    jsonb_build_object(
      'event', 'trabajo_finalizado',
      'contratacion_id', p_contratacion_id,
      'audience', 'trabajador'
    )
  );
END;
$$;

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
      'Indicaste un problema con el trabajo. Quedó en disputa y el chat sigue disponible. El saldo, si corresponde, se paga directo al profesional, fuera de la app.',
      jsonb_build_object(
        'event', 'conformidad_rechazada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );
  END IF;
END;
$$;
