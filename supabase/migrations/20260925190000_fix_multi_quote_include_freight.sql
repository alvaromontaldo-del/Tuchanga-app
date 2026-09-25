-- Ticket #50: el flete es por cotización. Un include_freight ausente o inválido
-- no suma el flete (antes el default true se lo cobraba a las demás ofertas).

ALTER TABLE public.orders
  ALTER COLUMN include_freight SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.quote_selection_includes_freight(p_sel jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_sel IS NULL OR NOT (p_sel ? 'include_freight') THEN false
    WHEN jsonb_typeof(p_sel->'include_freight') = 'boolean'
      THEN (p_sel->>'include_freight')::boolean
    WHEN lower(btrim(coalesce(p_sel->>'include_freight', ''))) IN ('true', 't', '1', 'yes')
      THEN true
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.quote_selection_includes_freight(jsonb) IS
  'true solo si esa selección trae include_freight verdadero. Si falta o es false, retiro en local.';

GRANT EXECUTE ON FUNCTION public.quote_selection_includes_freight(jsonb)
  TO authenticated, service_role;

-- create_material_checkout: mismo cuerpo que 20260820190000, con el flag por selección.
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
  v_quote_item_ids uuid[];
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
    SELECT array_agg(x::uuid) INTO v_quote_item_ids
    FROM jsonb_array_elements_text(coalesce(v_sel->'quote_item_ids', '[]'::jsonb)) AS t(x);
    SELECT array_agg(x::uuid) INTO v_item_ids
    FROM jsonb_array_elements_text(coalesce(v_sel->'item_ids', '[]'::jsonb)) AS t(x);
    v_include_freight := public.quote_selection_includes_freight(v_sel);

    IF (v_quote_item_ids IS NULL OR cardinality(v_quote_item_ids) < 1)
       AND (v_item_ids IS NULL OR cardinality(v_item_ids) < 1) THEN
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

    IF v_quote_item_ids IS NOT NULL AND cardinality(v_quote_item_ids) > 0 THEN
      SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_materials_only
      FROM public.quote_items qi
      JOIN public.request_items ri ON ri.id = qi.request_item_id
      WHERE qi.quote_id = v_quote_id
        AND qi.id = ANY (v_quote_item_ids);
    ELSE
      SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_materials_only
      FROM public.quote_items qi
      JOIN public.request_items ri ON ri.id = qi.request_item_id
      WHERE qi.quote_id = v_quote_id
        AND qi.request_item_id = ANY (v_item_ids)
        AND qi.variant_index = 1;
    END IF;

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
    SELECT array_agg(x::uuid) INTO v_quote_item_ids
    FROM jsonb_array_elements_text(coalesce(v_sel->'quote_item_ids', '[]'::jsonb)) AS t(x);
    SELECT array_agg(x::uuid) INTO v_item_ids
    FROM jsonb_array_elements_text(coalesce(v_sel->'item_ids', '[]'::jsonb)) AS t(x);
    v_include_freight := public.quote_selection_includes_freight(v_sel);

    SELECT * INTO v_quote FROM public.quotes WHERE id = v_quote_id FOR UPDATE;
    SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

    IF v_quote_item_ids IS NOT NULL AND cardinality(v_quote_item_ids) > 0 THEN
      UPDATE public.quote_items
      SET client_decision = CASE
        WHEN id = ANY (v_quote_item_ids) THEN 'accepted'
        ELSE 'rejected'
      END
      WHERE quote_id = v_quote_id;

      SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_store_total
      FROM public.quote_items qi
      JOIN public.request_items ri ON ri.id = qi.request_item_id
      WHERE qi.quote_id = v_quote_id
        AND qi.id = ANY (v_quote_item_ids);
    ELSE
      UPDATE public.quote_items
      SET client_decision = CASE
        WHEN request_item_id = ANY (v_item_ids) AND variant_index = 1 THEN 'accepted'
        ELSE 'rejected'
      END
      WHERE quote_id = v_quote_id;

      SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_store_total
      FROM public.quote_items qi
      JOIN public.request_items ri ON ri.id = qi.request_item_id
      WHERE qi.quote_id = v_quote_id
        AND qi.client_decision = 'accepted';
    END IF;

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

-- Lectura del flag por cotización sin depender del RLS de orders.
CREATE OR REPLACE FUNCTION public.list_material_quote_freight_flags(p_request_id uuid)
RETURNS TABLE (
  quote_id uuid,
  order_id uuid,
  include_freight boolean,
  accepted_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.material_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF v_req.client_id IS DISTINCT FROM v_uid
     AND v_req.professional_id IS DISTINCT FROM v_uid
     AND NOT EXISTS (
       SELECT 1 FROM public.quotes q
       WHERE q.request_id = p_request_id AND q.client_id = v_uid
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.orders o
       JOIN public.quotes q ON q.id = o.quote_id
       WHERE q.request_id = p_request_id
         AND (
           o.client_id = v_uid
           OR EXISTS (
             SELECT 1 FROM public.material_checkouts mc
             WHERE mc.id = o.payment_group_id AND mc.client_id = v_uid
           )
         )
     )
  THEN
    RAISE EXCEPTION 'not_request_party';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    o.id,
    o.include_freight,
    o.accepted_total
  FROM public.quotes q
  JOIN public.orders o ON o.quote_id = q.id
  WHERE q.request_id = p_request_id
    AND o.status IS DISTINCT FROM 'cancelled';
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_material_quote_freight_flags(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_material_quote_freight_flags(uuid) IS
  'include_freight y accepted_total por cotización del pedido. No comparte el flag entre ofertas.';

-- Órdenes ya guardadas: si el total no incluye el flete, el flag no puede quedar en true.
UPDATE public.orders o
SET
  include_freight = false,
  updated_at = now()
FROM (
  SELECT
    o2.id AS order_id,
    public.ceil_money(coalesce(sum(qi.unit_price * ri.quantity), 0)) AS materials
  FROM public.orders o2
  JOIN public.quotes q ON q.id = o2.quote_id
  JOIN public.quote_items qi
    ON qi.quote_id = o2.quote_id
   AND qi.client_decision = 'accepted'
  JOIN public.request_items ri ON ri.id = qi.request_item_id
  WHERE o2.include_freight = true
    AND q.freight_type = 'cost'
    AND coalesce(q.freight_cost, 0) > 0
    AND o2.status IS DISTINCT FROM 'cancelled'
  GROUP BY o2.id
) sub
WHERE o.id = sub.order_id
  AND o.include_freight = true
  AND sub.materials > 0
  AND o.accepted_total > 0
  AND o.accepted_total <= sub.materials;

-- Si el flag ya dice que no hay flete, el importe a cobrar al comercio tampoco lo suma.
UPDATE public.orders o
SET
  accepted_total = sub.materials,
  updated_at = now()
FROM (
  SELECT
    o2.id AS order_id,
    public.ceil_money(coalesce(sum(qi.unit_price * ri.quantity), 0)) AS materials
  FROM public.orders o2
  JOIN public.quote_items qi
    ON qi.quote_id = o2.quote_id
   AND qi.client_decision = 'accepted'
  JOIN public.request_items ri ON ri.id = qi.request_item_id
  WHERE o2.include_freight = false
    AND o2.status IS DISTINCT FROM 'cancelled'
  GROUP BY o2.id
) sub
WHERE o.id = sub.order_id
  AND o.include_freight = false
  AND sub.materials > 0
  AND o.accepted_total > sub.materials;
