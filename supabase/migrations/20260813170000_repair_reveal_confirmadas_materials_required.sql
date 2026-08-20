-- YaChanga — Repair reveal + Confirmadas (parciales pagadas / rechazo total).
-- Timestamp > 20260812200000
--
-- Reglas:
-- - Fee pagado + algunos ítems aceptados → Confirmadas (quote accepted, order deposit_paid)
-- - Fee pagado + todos aceptados → Confirmadas
-- - Rechazo TOTAL (sin pago) → Rechazadas (no tocar paid)

-- 1) get_material_order_reveal: también revela si contact_revealed_at está seteado.
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF v_order.client_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_order_client';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;

  v_revealed :=
    v_order.deposit_status IN ('paid', 'waived')
    OR v_order.status IN ('deposit_paid', 'completed')
    OR v_order.contact_revealed_at IS NOT NULL;

  IF v_revealed AND v_order.contact_revealed_at IS NULL THEN
    UPDATE public.orders
    SET contact_revealed_at = now(),
        updated_at = now()
    WHERE id = v_order.id
      AND contact_revealed_at IS NULL
    RETURNING * INTO v_order;
  END IF;

  -- Si hay fee pagado pero status/deposit inconsistentes, normalizar.
  IF v_revealed
     AND v_order.status IS DISTINCT FROM 'completed'
     AND (
       v_order.deposit_status IS DISTINCT FROM 'paid'
       OR v_order.status IS DISTINCT FROM 'deposit_paid'
     )
  THEN
    UPDATE public.orders
    SET
      deposit_status = CASE
        WHEN v_order.deposit_status = 'waived' THEN 'waived'
        ELSE 'paid'
      END,
      status = CASE
        WHEN v_order.status = 'completed' THEN 'completed'
        ELSE 'deposit_paid'
      END,
      contact_revealed_at = coalesce(contact_revealed_at, now()),
      updated_at = now()
    WHERE id = v_order.id
    RETURNING * INTO v_order;
  END IF;

  order_id := v_order.id;
  order_code := CASE WHEN v_revealed THEN v_order.order_code ELSE NULL END;
  status := v_order.status;
  deposit_status := v_order.deposit_status;
  deposit_amount := v_order.deposit_amount;
  accepted_total := v_order.accepted_total;
  verification_pin := CASE WHEN v_revealed THEN v_order.verification_pin ELSE NULL END;
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

-- 2) Backfill: órdenes pagadas / reveladas → quote accepted (Confirmadas).
UPDATE public.orders o
SET
  deposit_status = CASE
    WHEN o.deposit_status = 'waived' THEN 'waived'
    ELSE 'paid'
  END,
  status = CASE
    WHEN o.status = 'completed' THEN 'completed'
    ELSE 'deposit_paid'
  END,
  contact_revealed_at = coalesce(o.contact_revealed_at, now()),
  updated_at = now()
WHERE (
    o.contact_revealed_at IS NOT NULL
    OR o.deposit_status IN ('paid', 'waived')
    OR o.status IN ('deposit_paid', 'completed')
  )
  AND o.status IS DISTINCT FROM 'completed'
  AND (
    o.deposit_status IS DISTINCT FROM 'paid'
    OR o.status IS DISTINCT FROM 'deposit_paid'
  )
  AND o.deposit_status IS DISTINCT FROM 'waived';

UPDATE public.quotes q
SET status = 'accepted', updated_at = now()
FROM public.orders o
WHERE o.quote_id = q.id
  AND (
    o.deposit_status IN ('paid', 'waived')
    OR o.status IN ('deposit_paid', 'completed')
    OR o.contact_revealed_at IS NOT NULL
  )
  AND q.status IS DISTINCT FROM 'accepted'
  AND q.status IS DISTINCT FROM 'rejected';

-- 3) create_material_checkout: exigir ≥1 material (no solo flete).
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

    -- No permitir checkout solo con flete (sin materiales).
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
      coalesce(v_req.client_id, v_quote.client_id, v_uid),
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

COMMENT ON FUNCTION public.create_material_checkout(jsonb) IS
  'Checkout multi-comercio. Exige ≥1 material por selección (no solo flete).';
