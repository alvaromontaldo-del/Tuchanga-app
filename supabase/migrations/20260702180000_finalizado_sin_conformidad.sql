-- Finalizar trabajo sin paso de conformidad: el cliente puede reseñar al marcar finalizado.

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
    estado_trabajo = 'finalizado',
    finalizado_at = now(),
    completed_by_worker_at = now(),
    conformidad_aceptada = true,
    conformidad_solicitada_at = coalesce(conformidad_solicitada_at, now()),
    conformidad_respondida_at = coalesce(conformidad_respondida_at, now())
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional marcó el trabajo como finalizado. Podés dejar tu reseña.',
    jsonb_build_object(
      'event', 'trabajo_finalizado',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Marcaste el trabajo como finalizado.',
    jsonb_build_object(
      'event', 'trabajo_finalizado',
      'contratacion_id', p_contratacion_id,
      'audience', 'trabajador'
    )
  );
END;
$$;

-- Confirmación de saldo: mensaje sin atar reseña al pago (ya disponible al finalizar).
CREATE OR REPLACE FUNCTION public.trabajador_confirmar_recepcion_offline(p_contratacion_id uuid)
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
    RAISE EXCEPTION 'Solo el trabajador puede confirmar recepción';
  END IF;

  IF v_row.offline_pago_notificado_at IS NULL THEN
    RAISE EXCEPTION 'El cliente aún no notificó el pago del saldo';
  END IF;

  IF v_row.estado_pago = 'totalmente_pagado' THEN
    RAISE EXCEPTION 'El pago ya fue confirmado';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_pago = 'totalmente_pagado',
    paid_at = coalesce(paid_at, now()),
    offline_pago_confirmado_at = now()
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional confirmó la recepción del saldo.',
    jsonb_build_object(
      'event', 'saldo_confirmado_cliente',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Confirmaste la recepción del saldo. Trabajo pagado.',
    jsonb_build_object(
      'event', 'saldo_confirmado_trabajador',
      'contratacion_id', p_contratacion_id,
      'audience', 'trabajador'
    )
  );
END;
$$;
