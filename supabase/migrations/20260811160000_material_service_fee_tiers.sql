-- Costo de Servicio YaChanga (materiales): tramos degresivos + tope $23.000.
-- No es seña/pago a cuenta del producto: es tarifa de plataforma.

CREATE OR REPLACE FUNCTION public.calculate_material_service_fee(p_total numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total numeric := coalesce(p_total, 0);
  v_t1 numeric := 0;
  v_t2 numeric := 0;
  v_t3 numeric := 0;
  v_raw numeric;
  v_cap constant numeric := 23000;
  v_lim1 constant numeric := 200000;
  v_lim2 constant numeric := 500000;
BEGIN
  IF v_total <= 0 THEN
    RETURN 0;
  END IF;

  v_t1 := least(v_total, v_lim1) * 0.08;
  v_t2 := least(greatest(v_total - v_lim1, 0), v_lim2 - v_lim1) * 0.06;
  v_t3 := greatest(v_total - v_lim2, 0) * 0.04;
  v_raw := v_t1 + v_t2 + v_t3;

  RETURN round(least(v_raw, v_cap));
END;
$$;

COMMENT ON FUNCTION public.calculate_material_service_fee(numeric) IS
  'Costo de Servicio YaChanga sobre total de materiales: 8%/6%/4% por tramos, tope $23000.';

CREATE OR REPLACE FUNCTION public.material_deposit_rate()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 0::numeric;
$$;

COMMENT ON FUNCTION public.material_deposit_rate() IS
  'DEPRECATED. Usar calculate_material_service_fee(total).';

COMMENT ON COLUMN public.orders.deposit_amount IS
  'Costo de Servicio YaChanga (tarifa plataforma). No es seña ni pago a cuenta del comercio.';

CREATE OR REPLACE FUNCTION public.accept_material_quote(
  p_quote_id uuid,
  p_accepted_item_ids uuid[]
)
RETURNS TABLE (
  order_id uuid,
  deposit_amount numeric,
  accepted_total numeric,
  order_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_total numeric := 0;
  v_fee numeric := 0;
  v_order_id uuid;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_accepted_item_ids IS NULL OR cardinality(p_accepted_item_ids) < 1 THEN
    RAISE EXCEPTION 'no_items_selected';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;
  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'quote_not_sent';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
  IF v_req.client_id IS DISTINCT FROM v_uid AND v_quote.client_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_client';
  END IF;

  SELECT o.id INTO v_existing FROM public.orders o WHERE o.quote_id = p_quote_id;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'order_already_exists';
  END IF;

  UPDATE public.quote_items
  SET client_decision = CASE
    WHEN request_item_id = ANY (p_accepted_item_ids) THEN 'accepted'
    ELSE 'rejected'
  END
  WHERE quote_id = p_quote_id;

  SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_total
  FROM public.quote_items qi
  JOIN public.request_items ri ON ri.id = qi.request_item_id
  WHERE qi.quote_id = p_quote_id
    AND qi.client_decision = 'accepted';

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'accepted_total_zero';
  END IF;

  IF v_quote.freight_type = 'cost' THEN
    v_total := v_total + coalesce(v_quote.freight_cost, 0);
  END IF;

  v_total := public.ceil_money(v_total);
  v_fee := public.calculate_material_service_fee(v_total);
  IF v_fee < 1 AND v_total > 0 THEN
    v_fee := 1;
  END IF;

  UPDATE public.quotes
  SET status = 'accepted', updated_at = now()
  WHERE id = p_quote_id;

  INSERT INTO public.orders (
    quote_id,
    order_code,
    status,
    client_id,
    accepted_total,
    deposit_amount,
    deposit_status
  ) VALUES (
    p_quote_id,
    '',
    'pending_deposit',
    coalesce(v_req.client_id, v_quote.client_id, v_uid),
    v_total,
    v_fee,
    'pending'
  )
  RETURNING id INTO v_order_id;

  order_id := v_order_id;
  deposit_amount := v_fee;
  accepted_total := v_total;
  order_status := 'pending_deposit';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_material_quote(uuid, uuid[]) TO authenticated, service_role;

UPDATE public.orders
SET
  deposit_amount = GREATEST(public.calculate_material_service_fee(COALESCE(accepted_total, 0)), 1),
  updated_at = now()
WHERE deposit_status = 'pending'
  AND status IN ('pending_deposit', 'pending')
  AND COALESCE(accepted_total, 0) > 0;

CREATE OR REPLACE FUNCTION public.registrar_sena_material_aprobada(
  p_order_id uuid,
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
  v_order public.orders%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_pin text;
  v_existing uuid;
BEGIN
  IF p_order_id IS NULL OR btrim(coalesce(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;

  SELECT id INTO v_existing
  FROM public.transacciones_pago
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  INSERT INTO public.transacciones_pago (
    contratacion_id,
    material_order_id,
    cliente_id,
    tipo_pago,
    monto,
    estado_mp,
    mp_preference_id,
    mp_payment_id,
    idempotency_key,
    external_reference,
    metadata
  ) VALUES (
    NULL,
    p_order_id,
    v_order.client_id,
    'seña_materiales',
    greatest(coalesce(p_monto, 0), 0),
    'approved',
    nullif(p_mp_preference_id, ''),
    nullif(p_mp_payment_id, ''),
    p_idempotency_key,
    coalesce(nullif(p_external_reference, ''), 'order_id:' || p_order_id::text || '|tipo_pago:sena_materiales'),
    jsonb_build_object('source', 'registrar_sena_material_aprobada')
  );

  IF v_order.deposit_status = 'paid' AND v_order.status IN ('deposit_paid', 'completed') THEN
    RETURN;
  END IF;

  IF v_order.status NOT IN ('pending_deposit', 'pending') OR v_order.deposit_status <> 'pending' THEN
    RAISE EXCEPTION 'order_not_awaiting_deposit';
  END IF;

  v_pin := coalesce(v_order.verification_pin, public.generar_pin_verificacion());

  UPDATE public.orders
  SET
    deposit_status = 'paid',
    status = 'deposit_paid',
    verification_pin = v_pin,
    contact_revealed_at = coalesce(contact_revealed_at, now()),
    updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

  IF v_req.conversation_id IS NOT NULL THEN
    PERFORM public._chat_insert_system_event(
      v_req.conversation_id,
      v_order.client_id,
      'Costo de servicio YaChanga acreditado. Ya podés ver el comercio, el código y el PIN.',
      jsonb_build_object(
        'event', 'material_service_fee_paid',
        'kind', 'material_order',
        'order_id', v_order.id,
        'audience', 'todos'
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) TO service_role;
