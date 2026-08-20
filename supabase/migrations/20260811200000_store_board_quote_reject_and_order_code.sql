-- YaChanga — Kanban comercio: rechazo visible + order_code al pagar fee.
--
-- 1) reject_material_quote: deja de “colgar” en Cotizadas (target sigue quoted;
--    la app filtra por quotes.status = rejected; reforzamos ítems + updated_at).
-- 2) registrar_sena_material_aprobada: si order_code quedó vacío, generar uno.

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

  UPDATE public.quote_items
  SET client_decision = 'rejected'
  WHERE quote_id = p_quote_id
    AND client_decision = 'pending';

  UPDATE public.quotes
  SET status = 'rejected', updated_at = now()
  WHERE id = p_quote_id;

  -- No hay columna "rejected" en request_target_stores (pending|quoted|declined).
  -- El board del comercio filtra quotes.status = 'rejected' y las saca de Cotizadas.
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_material_quote(uuid) TO authenticated, service_role;

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
    -- Asegurar código aunque la orden ya estuviera marcada pagada.
    IF btrim(coalesce(v_order.order_code, '')) = '' THEN
      UPDATE public.orders
      SET order_code = public.generate_store_order_code(),
          updated_at = now()
      WHERE id = p_order_id
        AND btrim(coalesce(order_code, '')) = '';
    END IF;
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

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

  IF v_req.conversation_id IS NOT NULL THEN
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
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.registrar_sena_material_aprobada(uuid, numeric, text, text, text, text) IS
  'Marca fee materiales pagado (deposit_paid). Genera order_code si faltaba. Solo service_role.';
