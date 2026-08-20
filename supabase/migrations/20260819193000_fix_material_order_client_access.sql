-- Fix: cliente que paga fee de materiales debe poder ver PIN/código aunque
-- orders.client_id quedó con material_requests.client_id (p. ej. trabajador).

CREATE OR REPLACE FUNCTION public._material_order_payer_can_reveal(p_order_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = p_order_id
      AND (
        o.client_id = p_uid
        OR EXISTS (
          SELECT 1
          FROM public.material_checkouts mc
          WHERE mc.id = o.payment_group_id
            AND mc.client_id = p_uid
        )
        OR EXISTS (
          SELECT 1
          FROM public.quotes q
          WHERE q.id = o.quote_id
            AND q.client_id = p_uid
        )
        OR EXISTS (
          SELECT 1
          FROM public.quotes q
          JOIN public.material_requests mr ON mr.id = q.request_id
          WHERE q.id = o.quote_id
            AND mr.client_id = p_uid
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public._material_order_payer_can_reveal(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_material_order_reveal(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_code text,
  status text,
  deposit_status text,
  deposit_amount numeric,
  accepted_total numeric,
  verification_pin text,
  store_name text,
  store_phone text,
  store_address text,
  contact_revealed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_revealed boolean;
  v_pin text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF NOT public._material_order_payer_can_reveal(p_order_id, v_uid) THEN
    RAISE EXCEPTION 'not_order_client';
  END IF;

  -- Corregir client_id legacy cuando el pagador es el checkout o la quote.
  IF v_order.client_id IS DISTINCT FROM v_uid THEN
    IF EXISTS (
      SELECT 1
      FROM public.material_checkouts mc
      WHERE mc.id = v_order.payment_group_id
        AND mc.client_id = v_uid
    ) OR EXISTS (
      SELECT 1
      FROM public.quotes q
      WHERE q.id = v_order.quote_id
        AND q.client_id = v_uid
    ) THEN
      UPDATE public.orders
      SET client_id = v_uid, updated_at = now()
      WHERE id = p_order_id
      RETURNING * INTO v_order;
    END IF;
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  IF FOUND THEN
    SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  END IF;

  v_revealed :=
    v_order.deposit_status IN ('paid', 'waived')
    OR v_order.status IN ('deposit_paid', 'completed')
    OR v_order.contact_revealed_at IS NOT NULL;

  IF v_revealed THEN
    v_pin := coalesce(nullif(btrim(v_order.verification_pin), ''), public.generar_pin_verificacion());
    UPDATE public.orders AS o
    SET
      contact_revealed_at = coalesce(o.contact_revealed_at, now()),
      verification_pin = v_pin,
      order_code = CASE
        WHEN btrim(coalesce(o.order_code, '')) = '' THEN public.generate_store_order_code()
        ELSE o.order_code
      END,
      deposit_status = CASE
        WHEN o.deposit_status = 'waived' THEN 'waived'
        WHEN o.status = 'completed' THEN o.deposit_status
        ELSE 'paid'
      END,
      status = CASE
        WHEN o.status = 'completed' THEN 'completed'
        ELSE 'deposit_paid'
      END,
      updated_at = now()
    WHERE o.id = v_order.id
    RETURNING * INTO v_order;
  END IF;

  order_id := v_order.id;
  order_code := CASE WHEN v_revealed THEN v_order.order_code ELSE NULL END;
  status := v_order.status;
  deposit_status := v_order.deposit_status;
  deposit_amount := v_order.deposit_amount;
  accepted_total := v_order.accepted_total;
  verification_pin := CASE WHEN v_revealed THEN lpad(btrim(coalesce(v_order.verification_pin, '')), 4, '0') ELSE NULL END;
  store_name := CASE
    WHEN v_revealed THEN coalesce(nullif(trim(v_store.name), ''), 'Comercio')
    ELSE 'Comercio (oculto hasta pagar el costo de servicio)'
  END;
  store_phone := CASE WHEN v_revealed THEN v_store.phone ELSE NULL END;
  store_address := CASE WHEN v_revealed THEN v_store.address ELSE NULL END;
  contact_revealed := v_revealed;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_material_order_reveal(uuid) TO authenticated, service_role;

-- Órdenes nuevas: client_id = quien paga (auth.uid()).
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
  v_materials_only numeric;
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

    SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_materials_only
    FROM public.quote_items qi
    JOIN public.request_items ri ON ri.id = qi.request_item_id
    WHERE qi.quote_id = v_quote_id
      AND qi.request_item_id = ANY (v_item_ids);

    IF v_materials_only <= 0 THEN
      RAISE EXCEPTION 'materials_required';
    END IF;

    v_store_total := v_materials_only;
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

    IF v_store_total <= 0 THEN
      RAISE EXCEPTION 'materials_required';
    END IF;

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
      v_uid,
      v_store_total,
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
  v_total numeric;
  v_fee numeric;
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

  IF p_include_freight AND v_quote.freight_type = 'cost' THEN
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
    v_uid,
    v_total,
    v_fee,
    'pending',
    p_include_freight AND v_quote.freight_type = 'cost' AND coalesce(v_quote.freight_cost, 0) > 0
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

-- Backfill órdenes ya pagadas con client_id incorrecto.
UPDATE public.orders o
SET client_id = mc.client_id, updated_at = now()
FROM public.material_checkouts mc
WHERE o.payment_group_id = mc.id
  AND o.client_id IS DISTINCT FROM mc.client_id;

UPDATE public.orders o
SET client_id = q.client_id, updated_at = now()
FROM public.quotes q
JOIN public.material_requests mr ON mr.id = q.request_id
WHERE o.quote_id = q.id
  AND q.client_id IS NOT NULL
  AND o.client_id IS DISTINCT FROM q.client_id
  AND o.client_id = mr.professional_id;
