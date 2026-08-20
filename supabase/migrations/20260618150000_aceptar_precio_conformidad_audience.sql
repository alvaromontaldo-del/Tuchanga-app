-- Mensajes de aceptación de presupuesto y conformidad solo para el rol correcto.

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

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'Aguarde hasta que el profesional le envíe su disponibilidad horaria.',
    jsonb_build_object(
      'event', 'precio_aceptado_cliente',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'Envíe hasta 5 opciones para coordinar la visita.',
    jsonb_build_object(
      'event', 'precio_aceptado_trabajador',
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
