-- El cliente puede notificar el saldo offline desde que el trabajo está en curso (PIN validado).

CREATE OR REPLACE FUNCTION public.cliente_notificar_pago_offline(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_saldo numeric;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede notificar el pago del saldo';
  END IF;

  IF v_row.estado_trabajo NOT IN (
    'en_curso',
    'pendiente_conformidad',
    'finalizado',
    'pendiente_pago_diferencia',
    'disputa'
  ) THEN
    RAISE EXCEPTION 'Solo podés notificar el saldo una vez iniciado el trabajo';
  END IF;

  IF v_row.estado_pago <> 'seña_pagada' THEN
    RAISE EXCEPTION 'Estado de pago inválido para notificar saldo';
  END IF;

  IF v_row.offline_pago_notificado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ya notificaste el pago del saldo';
  END IF;

  v_saldo := greatest(v_row.precio_final - v_row.comision_app, 0);
  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'No hay saldo pendiente';
  END IF;

  UPDATE public.contrataciones
  SET offline_pago_notificado_at = now()
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'Indicaste que pagaste el saldo al profesional. Aguardá su confirmación.',
    jsonb_build_object(
      'event', 'saldo_pagado_cliente',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'El cliente indicó que pagó el saldo. Confirmá la recepción del pago.',
    jsonb_build_object(
      'event', 'saldo_pagado_trabajador',
      'contratacion_id', p_contratacion_id,
      'audience', 'trabajador'
    )
  );
END;
$$;
