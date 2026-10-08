-- #102 materiales: varias marcas por ítem, y cobrar solo la elegida.
-- #47 y #206 no cambian SQL (logística y aviso de coordinación son de la app).
--
-- Reconstruido desde pg_get_functiondef de producción (TuChangaAPP) el 2026-10-08.
-- No se cambia firma ni se otorga EXECUTE a anon.
--
-- Causa: el índice único quote_items_quote_id_request_item_id_key (quote_id, request_item_id)
-- rechaza la segunda marca. La app caía al fallback e insertaba solo la variante 1.
-- Las 47 filas vigentes tienen variant_index = 1, así que el único nuevo
-- (quote_id, request_item_id, variant_index) no choca con datos existentes.
--
-- accept_material_quote marcaba y sumaba TODAS las filas del request_item_id.
-- Ahora acepta por quote_items.id si el uuid es de una marca; si el cliente
-- manda el request_item_id (legado), acepta solo variant_index = 1 y rechaza
-- el resto. Dos marcas del mismo ítem en la misma selección abortan con
-- multiple_variants_selected (no se suman A+B+C).
--
-- create_material_checkout ya filtraba por quote_item_ids (o variant_index = 1
-- si no venían). Se agrega el mismo freno de una marca por ítem. El resto del
-- cuerpo (fees, flete, guards) queda igual.
--
-- notify_material_quote_in_chat sumaba todas las filas del ítem: con 3 marcas
-- el total del aviso triplicaba. Ahora toma una fila por request_item
-- (la de menor variant_index). Con los datos de hoy (solo variante 1) el
-- total no cambia.
--
-- Revisadas y sin cambio, porque no asumen una fila por ítem:
--   list_my_material_solicitudes (solo client_decision = accepted)
--   reject_material_quote, reject_stale_material_quotes,
--   _reject_unselected_material_quotes (actualizan todas las filas del quote)
--   delete_user_account (DELETE por quote_id)

ALTER TABLE public.quote_items
  DROP CONSTRAINT IF EXISTS quote_items_quote_id_request_item_id_key;

DROP INDEX IF EXISTS public.quote_items_quote_id_request_item_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.quote_items'::regclass
      AND conname = 'quote_items_quote_request_variant_uq'
  ) THEN
    ALTER TABLE public.quote_items
      ADD CONSTRAINT quote_items_quote_request_variant_uq
      UNIQUE (quote_id, request_item_id, variant_index);
  END IF;
END $$;

COMMENT ON CONSTRAINT quote_items_quote_request_variant_uq ON public.quote_items IS
  'Hasta 3 marcas por ítem (variant_index 1..3). Reemplaza el único (quote_id, request_item_id) que descartaba la segunda marca.';

CREATE OR REPLACE FUNCTION public.accept_material_quote(
  p_quote_id uuid,
  p_accepted_item_ids uuid[],
  p_include_freight boolean DEFAULT true
)
RETURNS TABLE(order_id uuid, deposit_amount numeric, accepted_total numeric, order_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- quote_items.id gana. El request_item_id legado acepta solo la variante 1
  -- y solo si esa marca no vino identificada por id.
  UPDATE public.quote_items qi
  SET client_decision = CASE
    WHEN qi.id = ANY (p_accepted_item_ids) THEN 'accepted'
    WHEN qi.request_item_id = ANY (p_accepted_item_ids)
      AND qi.variant_index = 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.quote_items chosen
        WHERE chosen.quote_id = qi.quote_id
          AND chosen.request_item_id = qi.request_item_id
          AND chosen.id = ANY (p_accepted_item_ids)
      )
    THEN 'accepted'
    ELSE 'rejected'
  END
  WHERE qi.quote_id = p_quote_id;

  IF EXISTS (
    SELECT 1
    FROM public.quote_items qi
    WHERE qi.quote_id = p_quote_id
      AND qi.client_decision = 'accepted'
    GROUP BY qi.request_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple_variants_selected';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.accept_material_quote(uuid, uuid[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_material_quote(uuid, uuid[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_material_quote(uuid, uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_material_quote(uuid, uuid[], boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.create_material_checkout(p_selections jsonb)
RETURNS TABLE(checkout_id uuid, primary_order_id uuid, service_fee numeric, materials_total numeric, order_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      IF EXISTS (
        SELECT 1
        FROM public.quote_items qi
        WHERE qi.quote_id = v_quote_id
          AND qi.id = ANY (v_quote_item_ids)
        GROUP BY qi.request_item_id
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'multiple_variants_selected';
      END IF;

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
      IF EXISTS (
        SELECT 1
        FROM public.quote_items qi
        WHERE qi.quote_id = v_quote_id
          AND qi.id = ANY (v_quote_item_ids)
        GROUP BY qi.request_item_id
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'multiple_variants_selected';
      END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.create_material_checkout(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_material_checkout(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_material_checkout(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_material_checkout(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_material_quote_in_chat(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_total numeric := 0;
  v_msg_id uuid;
  v_body text;
  v_store_count int := 0;
  v_quote_count int := 0;
  v_existing_meta jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  IF NOT FOUND OR v_store.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_store_owner';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
  IF NOT FOUND OR v_req.conversation_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Una fila por ítem (menor variant_index). Sumar las 3 marcas inflaba el total.
  SELECT coalesce(sum(picked.unit_price * picked.quantity), 0) INTO v_total
  FROM (
    SELECT DISTINCT ON (qi.request_item_id)
      qi.unit_price,
      ri.quantity
    FROM public.quote_items qi
    JOIN public.request_items ri ON ri.id = qi.request_item_id
    WHERE qi.quote_id = p_quote_id
    ORDER BY qi.request_item_id, qi.variant_index, qi.created_at
  ) picked;

  IF v_quote.freight_type = 'cost' THEN
    v_total := v_total + coalesce(v_quote.freight_cost, 0);
  END IF;
  v_total := public.ceil_money(v_total);

  SELECT
    count(*)::int,
    count(DISTINCT store_id)::int
  INTO v_quote_count, v_store_count
  FROM public.quotes
  WHERE request_id = v_req.id
    AND status IN ('sent', 'accepted');

  v_body := format(
    'Hay %s cotizaci%s de materiales de %s comercio%s. Tocá para comparar.',
    v_quote_count,
    CASE WHEN v_quote_count = 1 THEN 'ón' ELSE 'ones' END,
    v_store_count,
    CASE WHEN v_store_count = 1 THEN '' ELSE 's' END
  );

  -- Reusar mensaje existente del mismo request (evitar N tarjetas).
  SELECT m.id, m.metadata
  INTO v_msg_id, v_existing_meta
  FROM public.messages m
  WHERE m.conversation_id = v_req.conversation_id
    AND m.type = 'quotation'
    AND coalesce(m.metadata->>'kind', '') = 'material_quote'
    AND (
      m.metadata->>'request_id' = v_req.id::text
      OR m.metadata->>'requestId' = v_req.id::text
      OR m.metadata->>'materialListId' = v_req.id::text
    )
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_msg_id IS NOT NULL THEN
    UPDATE public.messages
    SET
      body = v_body,
      metadata = (coalesce(v_existing_meta, '{}'::jsonb) - 'title') || jsonb_build_object(
        'kind', 'material_quote',
        'quote_id', v_quote.id,
        'request_id', v_req.id,
        'store_id', v_store.id,
        'store_name', 'Comercio (oculto hasta pagar el costo de servicio)',
        'total', v_total,
        'freight_type', v_quote.freight_type,
        'freight_cost', v_quote.freight_cost,
        'quoteCount', v_quote_count,
        'storeCount', v_store_count,
        'last_quote_id', v_quote.id
      )
    WHERE id = v_msg_id;

    -- Soft-hide duplicados viejos del mismo request (UI también dedupea).
    UPDATE public.messages
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('hidden', true, 'superseded_by', v_msg_id)
    WHERE conversation_id = v_req.conversation_id
      AND id <> v_msg_id
      AND type = 'quotation'
      AND coalesce(metadata->>'kind', '') = 'material_quote'
      AND (
        metadata->>'request_id' = v_req.id::text
        OR metadata->>'requestId' = v_req.id::text
        OR metadata->>'materialListId' = v_req.id::text
      )
      AND coalesce((metadata->>'hidden')::boolean, false) IS NOT TRUE;

    RETURN v_msg_id;
  END IF;

  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    body,
    type,
    metadata
  ) VALUES (
    v_req.conversation_id,
    v_uid,
    v_body,
    'quotation',
    jsonb_build_object(
      'kind', 'material_quote',
      'quote_id', v_quote.id,
      'request_id', v_req.id,
      'store_id', v_store.id,
      'store_name', 'Comercio (oculto hasta pagar el costo de servicio)',
      'total', v_total,
      'freight_type', v_quote.freight_type,
      'freight_cost', v_quote.freight_cost,
      'quoteCount', v_quote_count,
      'storeCount', v_store_count,
      'last_quote_id', v_quote.id
    )
  )
  RETURNING id INTO v_msg_id;

  RETURN v_msg_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_material_quote_in_chat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_material_quote_in_chat(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_material_quote_in_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_material_quote_in_chat(uuid) TO service_role;
