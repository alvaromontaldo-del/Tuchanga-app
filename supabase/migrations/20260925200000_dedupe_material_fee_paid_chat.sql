-- Ticket #84 — Un solo aviso de chat al acreditar el costo de servicio
-- de materiales, aunque el checkout cubra varios comercios.
--
-- Causa: confirmar_sena_material_orden y registrar_sena_material_aprobada
-- recorrían cada orden del payment_group e insertaban
-- «Costo de servicio YaChanga acreditado…» en el mismo conversation_id
-- (el chat del trabajo). Con 2 comercios el cliente veía 2 burbujas iguales.
-- El push al comercio y el marcado de pago siguen siendo uno por orden.
--
-- Un comercio: el texto no cambia.
-- Varios comercios del mismo chat: un solo mensaje que aclara que el costo
-- cubre a todos.

CREATE OR REPLACE FUNCTION public._notify_material_service_fee_paid(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_order_id uuid,
  p_checkout_id uuid,
  p_store_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := greatest(coalesce(p_store_count, 1), 1);
  v_body text;
  v_meta jsonb;
BEGIN
  IF p_conversation_id IS NULL THEN
    RETURN;
  END IF;

  -- Idempotente: webhook + confirmación de la app no deben duplicar el aviso.
  IF p_checkout_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND m.type = 'system'
        AND m.metadata->>'event' = 'material_service_fee_paid'
        AND m.metadata->>'checkout_id' = p_checkout_id::text
    ) THEN
      RETURN;
    END IF;
  ELSIF p_order_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND m.type = 'system'
        AND m.metadata->>'event' = 'material_service_fee_paid'
        AND coalesce(m.metadata->>'checkout_id', '') = ''
        AND m.metadata->>'order_id' = p_order_id::text
    ) THEN
      RETURN;
    END IF;
  END IF;

  IF v_count > 1 THEN
    v_body := 'Costo de servicio YaChanga acreditado para todos los comercios. Ya podés ver cada comercio, su código y su PIN.';
  ELSE
    v_body := 'Costo de servicio YaChanga acreditado. Ya podés ver el comercio, el código y el PIN.';
  END IF;

  v_meta := jsonb_build_object(
    'event', 'material_service_fee_paid',
    'kind', 'material_order',
    'order_id', p_order_id,
    'audience', 'todos',
    'store_count', v_count
  );
  IF p_checkout_id IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object('checkout_id', p_checkout_id);
  END IF;

  PERFORM public._chat_insert_system_event(
    p_conversation_id,
    p_sender_id,
    v_body,
    v_meta
  );
END;
$$;

REVOKE ALL ON FUNCTION public._notify_material_service_fee_paid(uuid, uuid, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._notify_material_service_fee_paid(uuid, uuid, uuid, uuid, integer) TO service_role;

COMMENT ON FUNCTION public._notify_material_service_fee_paid(uuid, uuid, uuid, uuid, integer) IS
  'Un aviso de chat por checkout (o por orden suelta) al acreditar el costo de servicio de materiales. No marca el pago.';

-- ---------------------------------------------------------------------------
-- confirmar_sena_material_orden: un mensaje por conversación del grupo
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
  v_conv_ids uuid[] := ARRAY[]::uuid[];
  v_conv_counts integer[] := ARRAY[]::integer[];
  v_conv_orders uuid[] := ARRAY[]::uuid[];
  v_idx integer;
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
          v_idx := array_position(v_conv_ids, v_req.conversation_id);
          IF v_idx IS NULL THEN
            v_conv_ids := array_append(v_conv_ids, v_req.conversation_id);
            v_conv_counts := array_append(v_conv_counts, 1);
            v_conv_orders := array_append(v_conv_orders, v_sibling.id);
          ELSE
            v_conv_counts[v_idx] := v_conv_counts[v_idx] + 1;
          END IF;
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

    IF NOT v_already_paid THEN
      FOR v_idx IN 1 .. coalesce(cardinality(v_conv_ids), 0)
      LOOP
        PERFORM public._notify_material_service_fee_paid(
          v_conv_ids[v_idx],
          v_uid,
          v_conv_orders[v_idx],
          v_group_id,
          v_conv_counts[v_idx]
        );
      END LOOP;
    END IF;
  ELSE
    v_order := public._mark_material_order_fee_paid(p_order_id);

    IF NOT v_already_paid THEN
      SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
      SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

      IF v_req.conversation_id IS NOT NULL THEN
        PERFORM public._notify_material_service_fee_paid(
          v_req.conversation_id,
          v_uid,
          v_order.id,
          NULL,
          1
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
  'Marca fee pagado solo si ya hay transacción MP approved (o si nunca se inició MP). Un aviso de chat por checkout, no por comercio.';

-- ---------------------------------------------------------------------------
-- registrar_sena_material_aprobada: misma consolidación (webhook MP)
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
  v_client_id uuid;
  v_conv_ids uuid[] := ARRAY[]::uuid[];
  v_conv_counts integer[] := ARRAY[]::integer[];
  v_conv_orders uuid[] := ARRAY[]::uuid[];
  v_idx integer;
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
  v_client_id := v_order.client_id;

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
        v_idx := array_position(v_conv_ids, v_req.conversation_id);
        IF v_idx IS NULL THEN
          v_conv_ids := array_append(v_conv_ids, v_req.conversation_id);
          v_conv_counts := array_append(v_conv_counts, 1);
          v_conv_orders := array_append(v_conv_orders, v_sibling.id);
        ELSE
          v_conv_counts[v_idx] := v_conv_counts[v_idx] + 1;
        END IF;
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

    IF NOT v_already_paid THEN
      FOR v_idx IN 1 .. coalesce(cardinality(v_conv_ids), 0)
      LOOP
        PERFORM public._notify_material_service_fee_paid(
          v_conv_ids[v_idx],
          v_client_id,
          v_conv_orders[v_idx],
          v_group_id,
          v_conv_counts[v_idx]
        );
      END LOOP;
    END IF;
  ELSE
    v_order := public._mark_material_order_fee_paid(p_order_id);

    SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
    SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
    SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

    IF NOT v_already_paid AND v_req.conversation_id IS NOT NULL THEN
      PERFORM public._notify_material_service_fee_paid(
        v_req.conversation_id,
        v_client_id,
        v_order.id,
        NULL,
        1
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
  'Marca fee materiales pagado (deposit_paid) + quotes accepted en todo el payment_group. Un aviso de chat por checkout. Idempotente sin saltar mark. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Histórico: dejar una burbuja por checkout en cada chat
-- ---------------------------------------------------------------------------

WITH fee_msgs AS (
  SELECT
    id,
    conversation_id,
    metadata->>'checkout_id' AS checkout_id,
    metadata->>'order_id' AS order_id,
    created_at
  FROM public.messages
  WHERE type = 'system'
    AND metadata->>'event' = 'material_service_fee_paid'
    AND coalesce(metadata->>'checkout_id', '') <> ''
),
grouped AS (
  SELECT
    conversation_id,
    checkout_id,
    count(*) AS cnt,
    count(DISTINCT order_id) FILTER (WHERE coalesce(order_id, '') <> '') AS order_cnt,
    (array_agg(id ORDER BY created_at ASC, id ASC))[1] AS keep_id
  FROM fee_msgs
  GROUP BY conversation_id, checkout_id
  HAVING count(*) > 1
)
UPDATE public.messages msg
SET
  body = 'Costo de servicio YaChanga acreditado para todos los comercios. Ya podés ver cada comercio, su código y su PIN.',
  metadata = coalesce(msg.metadata, '{}'::jsonb) || jsonb_build_object('store_count', g.order_cnt)
FROM grouped g
WHERE msg.id = g.keep_id
  AND g.order_cnt > 1;

WITH fee_msgs AS (
  SELECT
    id,
    conversation_id,
    metadata->>'checkout_id' AS checkout_id,
    created_at
  FROM public.messages
  WHERE type = 'system'
    AND metadata->>'event' = 'material_service_fee_paid'
    AND coalesce(metadata->>'checkout_id', '') <> ''
),
grouped AS (
  SELECT
    conversation_id,
    checkout_id,
    (array_agg(id ORDER BY created_at ASC, id ASC))[1] AS keep_id
  FROM fee_msgs
  GROUP BY conversation_id, checkout_id
  HAVING count(*) > 1
)
DELETE FROM public.messages msg
USING fee_msgs f
JOIN grouped g
  ON g.conversation_id = f.conversation_id
 AND g.checkout_id = f.checkout_id
WHERE msg.id = f.id
  AND f.id <> g.keep_id;

-- Doble insert de la misma orden suelta (sin checkout): conservar el primero.
WITH singles AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY conversation_id, metadata->>'order_id'
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.messages
  WHERE type = 'system'
    AND metadata->>'event' = 'material_service_fee_paid'
    AND coalesce(metadata->>'checkout_id', '') = ''
    AND coalesce(metadata->>'order_id', '') <> ''
)
DELETE FROM public.messages msg
USING singles s
WHERE msg.id = s.id
  AND s.rn > 1;
