-- No bloquear el registro de seña si falla el mensaje system del chat.

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
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'registrar_seña chat cliente: %', SQLERRM;
    END;

    BEGIN
      PERFORM public._chat_insert_system_event(
        v_row.conversation_id,
        v_row.worker_id,
        'La seña fue pagada. Al llegar al domicilio, vas a tener que pedirle el PIN al cliente.',
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
