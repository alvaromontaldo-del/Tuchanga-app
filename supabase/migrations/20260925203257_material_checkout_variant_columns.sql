-- Ticket #86: al pagar el costo de servicio de materiales, create_material_checkout
-- (actualizado por el arreglo de flete multi-comercio) filtra quote_items.variant_index.
-- Esa columna estaba en la migración de variantes pero no en esta base, así que el RPC
-- abortaba con "column qi.variant_index does not exist" antes de crear la preferencia de MP.
-- No cambia el unique (quote_id, request_item_id): una fila por ítem sigue siendo válida
-- con variant_index = 1.

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS variant_index smallint NOT NULL DEFAULT 1;

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS variant_label text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.quote_items'::regclass
      AND conname = 'quote_items_variant_index_chk'
  ) THEN
    ALTER TABLE public.quote_items
      ADD CONSTRAINT quote_items_variant_index_chk
      CHECK (variant_index BETWEEN 1 AND 3);
  END IF;
END $$;

COMMENT ON COLUMN public.quote_items.variant_index IS
  '1..3 opciones del comercio para el mismo request_item. Las filas existentes quedan en 1.';
COMMENT ON COLUMN public.quote_items.variant_label IS
  'Etiqueta opcional de la variante (ej. marca).';

CREATE OR REPLACE FUNCTION public._uuid_array_from_json(p_arr jsonb)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(array_agg(x::uuid), ARRAY[]::uuid[])
  FROM jsonb_array_elements_text(coalesce(p_arr, '[]'::jsonb)) AS t(x)
  WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

REVOKE ALL ON FUNCTION public._uuid_array_from_json(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._uuid_array_from_json(jsonb) TO service_role;

COMMENT ON FUNCTION public._uuid_array_from_json(jsonb) IS
  'UUIDs de un array JSON. Descarta valores que no son UUID (p. ej. id sintético requestItem-1).';

-- Ignora quote_item_ids que no son UUID (ids sintéticos del fallback sin columna).
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
    v_quote_item_ids := public._uuid_array_from_json(v_sel->'quote_item_ids');
    v_item_ids := public._uuid_array_from_json(v_sel->'item_ids');
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
    v_quote_item_ids := public._uuid_array_from_json(v_sel->'quote_item_ids');
    v_item_ids := public._uuid_array_from_json(v_sel->'item_ids');
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

