-- #61 [P0] Cerrar fee de materiales sin Mercado Pago.
--
-- Cuerpos reconstruidos desde la última migración que los define.
-- No aplicar en producción desde el agente: lo aplica un revisor.
--
-- _assert_material_fee_mp_paid: supabase/migrations/20260818180000_mp_payment_required_and_quote_detail.sql
--   Único cambio: el RETURN temprano pasa a RAISE EXCEPTION 'mp_payment_required'.
-- registrar_sena_material_aprobada: supabase/migrations/20260925200000_dedupe_material_fee_paid_chat.sql
--   Único cambio: el guard de service_role copiado de registrar_seña_aprobada
--   (supabase/migrations/20260618140000_sena_trabajador_mensaje_exacto.sql).
-- confirmar_sena_material_orden y _mark_material_order_fee_paid: solo grants.

CREATE OR REPLACE FUNCTION public._assert_material_fee_mp_paid(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_has_tx boolean;
  v_has_approved boolean;
BEGIN
  SELECT payment_group_id INTO v_group FROM public.orders WHERE id = p_order_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.transacciones_pago t
    WHERE t.material_order_id = p_order_id
       OR (v_group IS NOT NULL AND t.material_order_id IN (
            SELECT o.id FROM public.orders o WHERE o.payment_group_id = v_group
          ))
  ) INTO v_has_tx;

  IF NOT v_has_tx THEN
    RAISE EXCEPTION 'mp_payment_required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.transacciones_pago t
    WHERE t.estado_mp = 'approved'
      AND (
        t.material_order_id = p_order_id
        OR (v_group IS NOT NULL AND t.material_order_id IN (
              SELECT o.id FROM public.orders o WHERE o.payment_group_id = v_group
            ))
      )
  ) INTO v_has_approved;

  IF NOT v_has_approved THEN
    RAISE EXCEPTION 'mp_payment_required';
  END IF;
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
  v_client_id uuid;
  v_conv_ids uuid[] := ARRAY[]::uuid[];
  v_conv_counts integer[] := ARRAY[]::integer[];
  v_conv_orders uuid[] := ARRAY[]::uuid[];
  v_idx integer;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role';
  END IF;

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

REVOKE EXECUTE ON FUNCTION
  public.confirmar_sena_material_orden(uuid),
  public._assert_material_fee_mp_paid(uuid),
  public._mark_material_order_fee_paid(uuid),
  public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.confirmar_sena_material_orden(uuid),
  public._assert_material_fee_mp_paid(uuid),
  public._mark_material_order_fee_paid(uuid),
  public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text)
TO service_role;
