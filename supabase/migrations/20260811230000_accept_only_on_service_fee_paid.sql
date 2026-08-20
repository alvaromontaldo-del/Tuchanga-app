-- YaChanga — quote.status='accepted' SOLO cuando el cliente paga el costo de servicio.
--
-- Antes: accept_material_quote marcaba quotes.accepted + orders.pending_deposit
--         → UI “aceptada sin pagar” / board “Esperando pago”.
-- Ahora: accept guarda selección + crea orden pending; accepted + deposit_paid
--         ocurren juntos en registrar_sena_material_aprobada / confirmar_sena.

-- ---------------------------------------------------------------------------
-- 0) Backfill: deshacer “aceptada sin pagar”
-- ---------------------------------------------------------------------------

UPDATE public.quotes q
SET status = 'sent', updated_at = now()
WHERE q.status = 'accepted'
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.quote_id = q.id
      AND o.deposit_status = 'pending'
      AND o.status IN ('pending_deposit', 'pending')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders o2
    WHERE o2.quote_id = q.id
      AND (
        o2.deposit_status IN ('paid', 'waived')
        OR o2.status IN ('deposit_paid', 'completed')
        OR o2.contact_revealed_at IS NOT NULL
      )
  );

-- Quotes “accepted” sin orden pagada (huérfanas / inconsistentes).
UPDATE public.quotes q
SET status = 'sent', updated_at = now()
WHERE q.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.quote_id = q.id
      AND (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
  );

-- Pedidos que pasaron a accepted solo por fee pendiente → volver a quoted.
UPDATE public.material_requests mr
SET status = 'quoted', updated_at = now()
WHERE mr.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM public.quotes q
    JOIN public.orders o ON o.quote_id = q.id
    WHERE q.request_id = mr.id
      AND (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
  );

-- ---------------------------------------------------------------------------
-- 1) accept_material_quote: selección + orden; quote sigue `sent`
-- ---------------------------------------------------------------------------

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
  IF v_req.status = 'completed' THEN
    RAISE EXCEPTION 'request_completed';
  END IF;

  SELECT o.id INTO v_existing FROM public.orders o WHERE o.quote_id = p_quote_id;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'order_already_exists';
  END IF;

  -- Selección persistida en ítems; quote.status='accepted' recién al pagar el fee.
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

  -- NO marcar quotes.status = 'accepted' acá.

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

COMMENT ON FUNCTION public.accept_material_quote(uuid, uuid[]) IS
  'Confirma selección de ítems de UN comercio y crea orden con fee pendiente. '
  'quotes.status permanece sent hasta pagar el costo de servicio YaChanga.';

-- ---------------------------------------------------------------------------
-- 2) registrar_sena_material_aprobada: accepted + deposit_paid al pagar
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
  v_quote public.quotes%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_pin text;
  v_already_paid boolean := false;
BEGIN
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
    v_already_paid := true;
    IF btrim(coalesce(v_order.order_code, '')) = '' THEN
      UPDATE public.orders
      SET order_code = public.generate_store_order_code(),
          updated_at = now()
      WHERE id = p_order_id
        AND btrim(coalesce(order_code, '')) = '';
    END IF;
  ELSIF v_order.status NOT IN ('pending_deposit', 'pending') OR v_order.deposit_status <> 'pending' THEN
    RAISE EXCEPTION 'order_not_awaiting_deposit';
  ELSE
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
  END IF;

  -- Aceptación formal = fee pagado (dispara trg_quotes_on_accepted → request accepted).
  UPDATE public.quotes
  SET status = 'accepted', updated_at = now()
  WHERE id = v_order.quote_id
    AND status IS DISTINCT FROM 'accepted';

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
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) IS
  'Marca fee materiales pagado (deposit_paid) y quotes.status=accepted. Push Confirmadas. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 3) confirmar_sena_material_orden (dev / sin MP): mismo criterio accepted
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
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_pin text;
  v_code text;
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

  IF v_order.deposit_status = 'paid' AND v_order.status IN ('deposit_paid', 'completed') THEN
    UPDATE public.quotes
    SET status = 'accepted', updated_at = now()
    WHERE id = v_order.quote_id
      AND status IS DISTINCT FROM 'accepted';

    SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
    SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
    order_id := v_order.id;
    order_code := v_order.order_code;
    verification_pin := v_order.verification_pin;
    store_name := v_store.name;
    store_phone := v_store.phone;
    store_address := v_store.address;
    deposit_amount := v_order.deposit_amount;
    RETURN NEXT;
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

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  v_code := v_order.order_code;

  IF v_req.conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id,
      sender_id,
      body,
      type,
      metadata
    ) VALUES (
      v_req.conversation_id,
      v_uid,
      format(
        'Costo de servicio YaChanga pagado. Código %s. Datos del comercio disponibles.',
        v_code
      ),
      'system',
      jsonb_build_object(
        'kind', 'material_order_reveal',
        'event', 'material_sena_pagada',
        'order_id', v_order.id,
        'order_code', v_code,
        'store_id', v_store.id,
        'audience', 'todos'
      )
    );
  END IF;

  order_id := v_order.id;
  order_code := v_code;
  verification_pin := v_pin;
  store_name := v_store.name;
  store_phone := v_store.phone;
  store_address := v_store.address;
  deposit_amount := v_order.deposit_amount;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_sena_material_orden(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.confirmar_sena_material_orden(uuid) IS
  'Confirma fee materiales (sin MP) y marca quote accepted. Solo el cliente dueño.';

-- ---------------------------------------------------------------------------
-- 4) reject_material_quote: permite cancelar orden pending_deposit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_material_quote(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
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

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.quote_id = p_quote_id
      AND (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'order_already_paid';
  END IF;

  -- Si había selección + fee pendiente, cancelar la orden.
  UPDATE public.orders
  SET status = 'cancelled', updated_at = now()
  WHERE quote_id = p_quote_id
    AND deposit_status = 'pending'
    AND status IN ('pending_deposit', 'pending');

  UPDATE public.quote_items
  SET client_decision = 'rejected'
  WHERE quote_id = p_quote_id;

  UPDATE public.quotes
  SET status = 'rejected', updated_at = now()
  WHERE id = p_quote_id;

  PERFORM public.enqueue_store_push(
    v_quote.store_id,
    'quote_rejected',
    'YaChanga',
    'Un cliente rechazó tu cotización.',
    jsonb_build_object(
      'type', 'store_board',
      'column', 'rechazadas',
      'quoteId', v_quote.id,
      'requestId', v_quote.request_id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_material_quote(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.reject_material_quote(uuid) IS
  'Rechazo total sin pago → Rechazadas. Cancela orden pending_deposit si existía.';

-- ---------------------------------------------------------------------------
-- 5) Auto-reject 72h: no tocar quotes con orden de fee pendiente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_stale_material_quotes(
  p_max_age interval DEFAULT interval '72 hours'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stale AS (
    SELECT q.id
    FROM public.quotes q
    WHERE q.status = 'sent'
      AND q.created_at < now() - p_max_age
      AND NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.quote_id = q.id
          AND o.status IN ('pending_deposit', 'pending', 'deposit_paid', 'completed')
          AND o.deposit_status IN ('pending', 'paid', 'waived')
      )
    FOR UPDATE OF q SKIP LOCKED
  ),
  upd_items AS (
    UPDATE public.quote_items qi
    SET client_decision = 'rejected'
    WHERE qi.quote_id IN (SELECT id FROM stale)
      AND qi.client_decision = 'pending'
    RETURNING qi.quote_id
  ),
  upd_quotes AS (
    UPDATE public.quotes q
    SET status = 'rejected', updated_at = now()
    WHERE q.id IN (SELECT id FROM stale)
    RETURNING q.id
  )
  SELECT count(*)::int INTO v_count FROM upd_quotes;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_stale_material_quotes(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_stale_material_quotes(interval) TO service_role;

COMMENT ON FUNCTION public.reject_stale_material_quotes(interval) IS
  'Rechaza quotes materiales sent antiguas sin orden activa. No toca selección con fee pendiente.';

-- ---------------------------------------------------------------------------
-- 6) Reveals: post-pago (accepted o deposit_paid), no filtrar solo accepted
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_material_request_quote_reveals(p_request_id uuid)
RETURNS TABLE (
  quote_id uuid,
  order_id uuid,
  deposit_status text,
  order_status text,
  contact_revealed boolean,
  store_name text,
  store_phone text,
  store_address text
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
  THEN
    RAISE EXCEPTION 'not_request_party';
  END IF;

  RETURN QUERY
  SELECT
    q.id AS quote_id,
    o.id AS order_id,
    o.deposit_status::text,
    o.status::text AS order_status,
    (
      o.deposit_status = 'paid'
      OR o.status IN ('deposit_paid', 'completed')
      OR o.contact_revealed_at IS NOT NULL
    ) AS contact_revealed,
    CASE
      WHEN (
        o.deposit_status = 'paid'
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) THEN coalesce(nullif(trim(s.name), ''), 'Comercio')
      ELSE NULL
    END AS store_name,
    CASE
      WHEN (
        o.deposit_status = 'paid'
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) THEN s.phone
      ELSE NULL
    END AS store_phone,
    CASE
      WHEN (
        o.deposit_status = 'paid'
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) THEN s.address
      ELSE NULL
    END AS store_address
  FROM public.quotes q
  JOIN public.orders o ON o.quote_id = q.id
  JOIN public.stores s ON s.id = q.store_id
  WHERE q.request_id = p_request_id
    AND (
      q.status = 'accepted'
      OR o.deposit_status IN ('paid', 'waived')
      OR o.status IN ('deposit_paid', 'completed')
      OR o.contact_revealed_at IS NOT NULL
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_material_request_quote_reveals(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_material_request_quote_reveals(uuid) IS
  'Batch reveal de comercios post-pago (fee acreditado / quote accepted).';
