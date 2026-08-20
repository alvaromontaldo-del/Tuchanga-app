-- YaChanga — Fix crítico: fee pagado → Confirmadas + reveal coherente.
--
-- Causas cubiertas:
-- 1) confirmar_sena_material_orden NO marcaba hermanas del payment_group
--    (checkout multi-comercio: solo primary quedaba deposit_paid).
-- 2) registrar_sena_material_aprobada hacía RETURN tempr de idempotencia
--    sin re-asegurar deposit_paid / quote accepted.
-- 3) Backfill de inconsistencias paid/revealed → accepted.

-- ---------------------------------------------------------------------------
-- 1) confirmar_sena_material_orden: mismo criterio que registrar (grupo)
-- ---------------------------------------------------------------------------
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

GRANT EXECUTE ON FUNCTION public.confirmar_sena_material_orden(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.confirmar_sena_material_orden(uuid) IS
  'Confirma fee materiales (retorno app / sin webhook). Marca todo el payment_group + quotes accepted. Solo cliente dueño.';

-- ---------------------------------------------------------------------------
-- 2) registrar: idempotencia no debe saltar el mark de órdenes
-- ---------------------------------------------------------------------------
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
      -- Re-asegurar estado aunque la tx ya exista (no RETURN ciego).
      v_group_id := v_order.payment_group_id;
      IF v_group_id IS NOT NULL THEN
        FOR v_sibling IN
          SELECT * FROM public.orders
          WHERE payment_group_id = v_group_id
          ORDER BY created_at ASC
          FOR UPDATE
        LOOP
          PERFORM public._mark_material_order_fee_paid(v_sibling.id);
        END LOOP;
        UPDATE public.material_checkouts
        SET status = 'paid', updated_at = now()
        WHERE id = v_group_id AND status IS DISTINCT FROM 'paid';
      ELSE
        PERFORM public._mark_material_order_fee_paid(p_order_id);
      END IF;
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

COMMENT ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) IS
  'Marca fee materiales pagado (deposit_paid) + quotes accepted en todo el payment_group. Idempotente sin saltar mark. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 3) Backfill inconsistencias
-- ---------------------------------------------------------------------------
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

-- Si hay grupo pagado parcialmente, completar hermanas pending del mismo checkout.
DO $$
DECLARE
  v_gid uuid;
  v_oid uuid;
BEGIN
  FOR v_gid IN
    SELECT DISTINCT o.payment_group_id
    FROM public.orders o
    WHERE o.payment_group_id IS NOT NULL
      AND (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
  LOOP
    FOR v_oid IN
      SELECT o2.id FROM public.orders o2
      WHERE o2.payment_group_id = v_gid
        AND o2.deposit_status = 'pending'
        AND o2.status IN ('pending_deposit', 'pending')
    LOOP
      PERFORM public._mark_material_order_fee_paid(v_oid);
    END LOOP;

    UPDATE public.material_checkouts
    SET status = 'paid', updated_at = now()
    WHERE id = v_gid AND status IS DISTINCT FROM 'paid';
  END LOOP;
END $$;
