-- YaChanga 2026-08-12: fees (ceil + tramos materiales + 22% servicios),
-- flete opcional, checkout multi-comercio con un solo pago de fee.

-- ---------------------------------------------------------------------------
-- 1) Fee materiales: tramos + tope $23.000 + CEIL
--    ≤200k → 8%; 200001–316667 → 16000+6%*(t-200k); >316667 → 23000
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_material_service_fee(p_total numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total numeric := coalesce(p_total, 0);
  v_raw numeric;
  v_cap constant numeric := 23000;
  v_lim1 constant numeric := 200000;
  v_break constant numeric := 316667;
BEGIN
  IF v_total <= 0 THEN
    RETURN 0;
  END IF;

  IF v_total <= v_lim1 THEN
    v_raw := v_total * 0.08;
  ELSIF v_total <= v_break THEN
    v_raw := 16000 + (v_total - v_lim1) * 0.06;
  ELSE
    RETURN v_cap;
  END IF;

  RETURN least(ceil(v_raw), v_cap);
END;
$$;

COMMENT ON FUNCTION public.calculate_material_service_fee(numeric) IS
  'Costo de Servicio materiales: ≤200k 8%; hasta 316667 $16k+6% excedente; luego tope $23000. Siempre CEIL.';

-- ---------------------------------------------------------------------------
-- 2) Fee trabajador/servicio: 22% aditivo del neto cotizado (100 → 22)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calc_precios_contratacion(p_precio_trabajador numeric)
RETURNS TABLE (precio_final numeric, comision_app numeric)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_neto numeric;
  v_comision numeric;
  v_final numeric;
BEGIN
  IF p_precio_trabajador IS NULL OR p_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;

  v_neto := ceil(p_precio_trabajador);
  v_comision := ceil(v_neto * 0.22);
  v_final := v_neto + v_comision;

  RETURN QUERY SELECT v_final, v_comision;
END;
$$;

COMMENT ON FUNCTION public.calc_precios_contratacion(numeric) IS
  'Comisión YaChanga = CEIL(neto * 0.22). Precio final = neto + comisión.';

-- ---------------------------------------------------------------------------
-- 3) Checkout multi-comercio
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.material_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.material_requests (id) ON DELETE SET NULL,
  service_fee numeric(12, 2) NOT NULL CHECK (service_fee >= 0),
  materials_total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (materials_total >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  primary_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_checkouts_client
  ON public.material_checkouts (client_id, created_at DESC);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_group_id uuid REFERENCES public.material_checkouts (id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS include_freight boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_orders_payment_group
  ON public.orders (payment_group_id)
  WHERE payment_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) accept_material_quote: flete opcional
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.accept_material_quote(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.accept_material_quote(
  p_quote_id uuid,
  p_accepted_item_ids uuid[],
  p_include_freight boolean DEFAULT true
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
  v_include_freight boolean := coalesce(p_include_freight, true);
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
  IF v_req.status = 'completed' THEN
    RAISE EXCEPTION 'request_completed';
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

  IF v_include_freight AND v_quote.freight_type = 'cost' THEN
    v_total := v_total + coalesce(v_quote.freight_cost, 0);
  END IF;

  v_total := public.ceil_money(v_total);
  v_fee := public.calculate_material_service_fee(v_total);
  IF v_fee < 1 AND v_total > 0 THEN
    v_fee := 1;
  END IF;

  INSERT INTO public.orders (
    quote_id,
    order_code,
    status,
    client_id,
    accepted_total,
    deposit_amount,
    deposit_status,
    include_freight
  ) VALUES (
    p_quote_id,
    '',
    'pending_deposit',
    coalesce(v_req.client_id, v_quote.client_id, v_uid),
    v_total,
    v_fee,
    'pending',
    v_include_freight AND v_quote.freight_type = 'cost' AND coalesce(v_quote.freight_cost, 0) > 0
  )
  RETURNING id INTO v_order_id;

  order_id := v_order_id;
  deposit_amount := v_fee;
  accepted_total := v_total;
  order_status := 'pending_deposit';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_material_quote(uuid, uuid[], boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.accept_material_quote(uuid, uuid[], boolean) IS
  'Selección de ítems + orden pending. p_include_freight: si false no suma flete (retiro en local).';

-- ---------------------------------------------------------------------------
-- 5) create_material_checkout: multi-comercio, un solo fee sobre la suma
--    p_selections: [{ "quote_id": "...", "item_ids": ["..."], "include_freight": true }]
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_material_checkout(p_selections jsonb)
RETURNS TABLE (
  checkout_id uuid,
  primary_order_id uuid,
  service_fee numeric,
  materials_total numeric,
  order_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sel jsonb;
  v_quote_id uuid;
  v_item_ids uuid[];
  v_include_freight boolean;
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_store_total numeric;
  v_grand numeric := 0;
  v_fee numeric := 0;
  v_checkout_id uuid;
  v_order_id uuid;
  v_primary uuid;
  v_order_ids uuid[] := ARRAY[]::uuid[];
  v_request_id uuid;
  v_existing uuid;
  v_i int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'array' OR jsonb_array_length(p_selections) < 1 THEN
    RAISE EXCEPTION 'no_selections';
  END IF;

  -- Validar y acumular totales (sin crear órdenes aún).
  FOR v_sel IN SELECT value FROM jsonb_array_elements(p_selections)
  LOOP
    v_quote_id := (v_sel->>'quote_id')::uuid;
    SELECT array_agg(x::uuid) INTO v_item_ids
    FROM jsonb_array_elements_text(coalesce(v_sel->'item_ids', '[]'::jsonb)) AS t(x);
    v_include_freight := coalesce((v_sel->>'include_freight')::boolean, true);

    IF v_item_ids IS NULL OR cardinality(v_item_ids) < 1 THEN
      RAISE EXCEPTION 'no_items_selected';
    END IF;

    SELECT * INTO v_quote FROM public.quotes WHERE id = v_quote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
    IF v_quote.status <> 'sent' THEN RAISE EXCEPTION 'quote_not_sent'; END IF;

    SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
    IF v_req.client_id IS DISTINCT FROM v_uid AND v_quote.client_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'not_client';
    END IF;
    IF v_req.status = 'completed' THEN RAISE EXCEPTION 'request_completed'; END IF;

    SELECT o.id INTO v_existing FROM public.orders o WHERE o.quote_id = v_quote_id;
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'order_already_exists'; END IF;

    IF v_request_id IS NULL THEN
      v_request_id := v_quote.request_id;
    ELSIF v_request_id IS DISTINCT FROM v_quote.request_id THEN
      RAISE EXCEPTION 'mixed_requests';
    END IF;

    SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_store_total
    FROM public.quote_items qi
    JOIN public.request_items ri ON ri.id = qi.request_item_id
    WHERE qi.quote_id = v_quote_id
      AND qi.request_item_id = ANY (v_item_ids);

    IF v_store_total <= 0 THEN RAISE EXCEPTION 'accepted_total_zero'; END IF;

    IF v_include_freight AND v_quote.freight_type = 'cost' AND coalesce(v_quote.freight_cost, 0) > 0 THEN
      v_store_total := v_store_total + coalesce(v_quote.freight_cost, 0);
    END IF;

    v_grand := v_grand + v_store_total;
  END LOOP;

  v_grand := public.ceil_money(v_grand);
  v_fee := public.calculate_material_service_fee(v_grand);
  IF v_fee < 1 AND v_grand > 0 THEN
    v_fee := 1;
  END IF;

  INSERT INTO public.material_checkouts (
    client_id, request_id, service_fee, materials_total, status
  ) VALUES (
    v_uid, v_request_id, v_fee, v_grand, 'pending'
  )
  RETURNING id INTO v_checkout_id;

  -- Crear órdenes y marcar ítems.
  FOR v_sel IN SELECT value FROM jsonb_array_elements(p_selections)
  LOOP
    v_i := v_i + 1;
    v_quote_id := (v_sel->>'quote_id')::uuid;
    SELECT array_agg(x::uuid) INTO v_item_ids
    FROM jsonb_array_elements_text(coalesce(v_sel->'item_ids', '[]'::jsonb)) AS t(x);
    v_include_freight := coalesce((v_sel->>'include_freight')::boolean, true);

    SELECT * INTO v_quote FROM public.quotes WHERE id = v_quote_id FOR UPDATE;
    SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

    UPDATE public.quote_items
    SET client_decision = CASE
      WHEN request_item_id = ANY (v_item_ids) THEN 'accepted'
      ELSE 'rejected'
    END
    WHERE quote_id = v_quote_id;

    SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_store_total
    FROM public.quote_items qi
    JOIN public.request_items ri ON ri.id = qi.request_item_id
    WHERE qi.quote_id = v_quote_id
      AND qi.client_decision = 'accepted';

    IF v_include_freight AND v_quote.freight_type = 'cost' AND coalesce(v_quote.freight_cost, 0) > 0 THEN
      v_store_total := v_store_total + coalesce(v_quote.freight_cost, 0);
    ELSE
      v_include_freight := false;
    END IF;

    v_store_total := public.ceil_money(v_store_total);

    INSERT INTO public.orders (
      quote_id,
      order_code,
      status,
      client_id,
      accepted_total,
      deposit_amount,
      deposit_status,
      payment_group_id,
      include_freight
    ) VALUES (
      v_quote_id,
      '',
      'pending_deposit',
      coalesce(v_req.client_id, v_quote.client_id, v_uid),
      v_store_total,
      -- Fee único del grupo: se cobra vía primary_order; siblings muestran el mismo fee de grupo.
      v_fee,
      'pending',
      v_checkout_id,
      v_include_freight
    )
    RETURNING id INTO v_order_id;

    v_order_ids := array_append(v_order_ids, v_order_id);
    IF v_primary IS NULL THEN
      v_primary := v_order_id;
    END IF;
  END LOOP;

  UPDATE public.material_checkouts
  SET primary_order_id = v_primary, updated_at = now()
  WHERE id = v_checkout_id;

  checkout_id := v_checkout_id;
  primary_order_id := v_primary;
  service_fee := v_fee;
  materials_total := v_grand;
  order_ids := v_order_ids;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_material_checkout(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_material_checkout(jsonb) IS
  'Crea órdenes pending por comercio + material_checkout con un solo service_fee = ceil(fee(suma)).';

-- ---------------------------------------------------------------------------
-- 6) Al pagar una orden del grupo, marcar todas las del payment_group
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._mark_material_order_fee_paid(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_pin text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_order.deposit_status = 'paid' AND v_order.status IN ('deposit_paid', 'completed') THEN
    IF btrim(coalesce(v_order.order_code, '')) = '' THEN
      UPDATE public.orders
      SET order_code = public.generate_store_order_code(), updated_at = now()
      WHERE id = p_order_id AND btrim(coalesce(order_code, '')) = ''
      RETURNING * INTO v_order;
    END IF;
    RETURN v_order;
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
    order_code = CASE
      WHEN btrim(coalesce(order_code, '')) = '' THEN public.generate_store_order_code()
      ELSE order_code
    END,
    updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  UPDATE public.quotes
  SET status = 'accepted', updated_at = now()
  WHERE id = v_order.quote_id
    AND status IS DISTINCT FROM 'accepted';

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_sena_material_aprobada(
  p_order_id uuid,
  p_monto numeric,
  p_mp_payment_id text DEFAULT NULL,
  p_mp_preference_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_external_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_sibling public.orders%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_already_paid boolean := false;
  v_group_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF btrim(coalesce(p_idempotency_key, '')) <> '' THEN
    SELECT id INTO v_existing
    FROM public.transacciones_pago
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN;
    END IF;
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
    coalesce(nullif(p_idempotency_key, ''), 'manual:' || p_order_id::text || ':' || clock_timestamp()::text),
    coalesce(nullif(p_external_reference, ''), 'order_id:' || p_order_id::text || '|tipo_pago:sena_materiales'),
    jsonb_build_object(
      'source', 'registrar_sena_material_aprobada',
      'payment_group_id', v_order.payment_group_id
    )
  );

  v_already_paid := (v_order.deposit_status = 'paid' AND v_order.status IN ('deposit_paid', 'completed'));
  v_group_id := v_order.payment_group_id;

  IF v_group_id IS NOT NULL THEN
    FOR v_sibling IN
      SELECT * FROM public.orders
      WHERE payment_group_id = v_group_id
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      PERFORM public._mark_material_order_fee_paid(v_sibling.id);

      SELECT * INTO v_quote FROM public.quotes WHERE id = v_sibling.quote_id;
      SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
      SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
      SELECT * INTO v_order FROM public.orders WHERE id = v_sibling.id;

      IF NOT v_already_paid AND v_req.conversation_id IS NOT NULL THEN
        PERFORM public._chat_insert_system_event(
          v_req.conversation_id,
          v_order.client_id,
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

      IF NOT v_already_paid THEN
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

    SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
    SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
    SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

    IF NOT v_already_paid AND v_req.conversation_id IS NOT NULL THEN
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

    IF NOT v_already_paid THEN
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
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7) MP preferencia: ceil del deposit_amount (defensa)
--    (edge function también aplica ceil; SQL deja montos enteros)
-- ---------------------------------------------------------------------------

UPDATE public.orders
SET
  deposit_amount = GREATEST(public.calculate_material_service_fee(COALESCE(accepted_total, 0)), 1),
  updated_at = now()
WHERE deposit_status = 'pending'
  AND status IN ('pending_deposit', 'pending')
  AND COALESCE(accepted_total, 0) > 0
  AND payment_group_id IS NULL;
