-- Cerrar atajo: no se puede marcar fee pagado sin transacción MP approved
-- (si nunca se creó preferencia, se permite solo para entornos sin MP).
-- Detalle de cotización de servicio obligatorio.
-- Comisión trabajador: 22% aditivo (neto 100 → fee 22 → final 122).

CREATE OR REPLACE FUNCTION public.calc_precios_contratacion(p_precio_trabajador numeric)
RETURNS TABLE (precio_final numeric, comision_app numeric)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_neto numeric;
  v_comision numeric;
BEGIN
  IF p_precio_trabajador IS NULL OR p_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;
  v_neto := ceil(p_precio_trabajador);
  v_comision := ceil(v_neto * 0.22);
  RETURN QUERY SELECT v_neto + v_comision, v_comision;
END;
$$;

CREATE OR REPLACE FUNCTION public.crear_cotizacion(
  p_conversation_id uuid,
  p_precio_trabajador numeric,
  p_service_detail text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations%rowtype;
  v_precios record;
  v_id uuid;
  v_detail text;
  v_neto numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversación inexistente';
  END IF;

  IF v_conv.trabajador_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede cotizar';
  END IF;

  v_detail := coalesce(trim(p_service_detail), '');
  IF v_detail = '' THEN
    RAISE EXCEPTION 'El detalle del servicio es obligatorio';
  END IF;

  PERFORM public._assert_sin_contratacion_activa(p_conversation_id);

  v_neto := ceil(p_precio_trabajador);
  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);

  INSERT INTO public.contrataciones (
    conversation_id,
    worker_id,
    client_id,
    precio_trabajador,
    precio_final,
    comision_app,
    service_detail,
    estado_trabajo,
    estado_pago
  )
  VALUES (
    p_conversation_id,
    v_conv.trabajador_id,
    v_conv.cliente_id,
    v_neto,
    v_precios.precio_final,
    v_precios.comision_app,
    v_detail,
    'precio_cotizado',
    'pendiente_seña'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
  VALUES (
    p_conversation_id,
    auth.uid(),
    v_detail,
    'quotation',
    jsonb_build_object(
      'contratacion_id', v_id,
      'precio_final', v_precios.precio_final,
      'precio_trabajador', v_neto,
      'service_detail', v_detail
    )
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_material_fee_mp_paid(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_has_tx boolean;
  v_has_approved boolean;
BEGIN
  SELECT payment_group_id INTO v_group FROM public.orders WHERE id = p_order_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.transacciones_pago t
    WHERE t.material_order_id = p_order_id
       OR (v_group IS NOT NULL AND t.material_order_id IN (
            SELECT o.id FROM public.orders o WHERE o.payment_group_id = v_group
          ))
  ) INTO v_has_tx;

  IF NOT v_has_tx THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.transacciones_pago t
    WHERE t.estado_mp = 'approved'
      AND (
        t.material_order_id = p_order_id
        OR (v_group IS NOT NULL AND t.material_order_id IN (
              SELECT o.id FROM public.orders o WHERE o.payment_group_id = v_group
            ))
      )
  ) INTO v_has_approved;

  IF NOT v_has_approved THEN
    RAISE EXCEPTION 'mp_payment_required';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirmar_sena_material_orden(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_code text,
  verification_pin text,
  store_name text,
  store_phone text,
  store_address text,
  deposit_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_sibling public.orders%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_group_id uuid;
  v_already_paid boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_order.client_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_order_client';
  END IF;

  v_already_paid := (
    v_order.deposit_status = 'paid'
    AND v_order.status IN ('deposit_paid', 'completed')
  );
  v_group_id := v_order.payment_group_id;

  IF NOT v_already_paid THEN
    PERFORM public._assert_material_fee_mp_paid(p_order_id);
  END IF;

  IF v_group_id IS NOT NULL THEN
    FOR v_sibling IN
      SELECT * FROM public.orders
      WHERE payment_group_id = v_group_id
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      PERFORM public._mark_material_order_fee_paid(v_sibling.id);

      IF NOT v_already_paid THEN
        SELECT * INTO v_quote FROM public.quotes WHERE id = v_sibling.quote_id;
        SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
        SELECT * INTO v_order FROM public.orders WHERE id = v_sibling.id;

        IF v_req.conversation_id IS NOT NULL THEN
          PERFORM public._chat_insert_system_event(
            v_req.conversation_id,
            v_uid,
            'Costo de servicio YaChanga acreditado. Ya podés ver el comercio, el código y el PIN.',
            jsonb_build_object(
              'event', 'material_service_fee_paid',
              'kind', 'material_order',
              'order_id', v_order.id,
              'checkout_id', v_group_id,
              'audience', 'todos'
            )
          );
        END IF;

        PERFORM public.enqueue_store_push(
          v_quote.store_id,
          'fee_paid',
          'YaChanga',
          'Pedido confirmado: el cliente pagó el costo de servicio. Prepará el pedido '
            || coalesce(v_order.order_code, '') || '.',
          jsonb_build_object(
            'type', 'store_board',
            'column', 'confirmadas',
            'orderId', v_order.id,
            'orderCode', v_order.order_code,
            'quoteId', v_quote.id,
            'requestId', v_quote.request_id
          )
        );
      END IF;
    END LOOP;

    UPDATE public.material_checkouts
    SET status = 'paid', updated_at = now()
    WHERE id = v_group_id AND status IS DISTINCT FROM 'paid';
  ELSE
    v_order := public._mark_material_order_fee_paid(p_order_id);

    IF NOT v_already_paid THEN
      SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
      SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

      IF v_req.conversation_id IS NOT NULL THEN
        PERFORM public._chat_insert_system_event(
          v_req.conversation_id,
          v_uid,
          'Costo de servicio YaChanga acreditado. Ya podés ver el comercio, el código y el PIN.',
          jsonb_build_object(
            'event', 'material_service_fee_paid',
            'kind', 'material_order',
            'order_id', v_order.id,
            'audience', 'todos'
          )
        );
      END IF;

      PERFORM public.enqueue_store_push(
        v_quote.store_id,
        'fee_paid',
        'YaChanga',
        'Pedido confirmado: el cliente pagó el costo de servicio. Prepará el pedido '
          || coalesce(v_order.order_code, '') || '.',
        jsonb_build_object(
          'type', 'store_board',
          'column', 'confirmadas',
          'orderId', v_order.id,
          'orderCode', v_order.order_code,
          'quoteId', v_quote.id,
          'requestId', v_quote.request_id
        )
      );
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;

  order_id := v_order.id;
  order_code := v_order.order_code;
  verification_pin := v_order.verification_pin;
  store_name := coalesce(nullif(trim(v_store.name), ''), 'Comercio');
  store_phone := v_store.phone;
  store_address := v_store.address;
  deposit_amount := v_order.deposit_amount;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.confirmar_sena_material_orden(uuid) IS
  'Marca fee pagado solo si ya hay transacción MP approved (o si nunca se inició MP).';
