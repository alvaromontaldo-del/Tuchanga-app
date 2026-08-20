-- Fix: column reference "status" is ambiguous in completar_orden_material_con_pin
-- (RETURNS TABLE status shadows orders.status / material_requests.status).

CREATE OR REPLACE FUNCTION public.completar_orden_material_con_pin(
  p_order_code text,
  p_pin text
)
RETURNS TABLE (
  order_id uuid,
  order_code text,
  status text
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
  v_raw text := upper(trim(coalesce(p_order_code, '')));
  v_digits text := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_pin text := lpad(trim(coalesce(p_pin, '')), 4, '0');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF v_digits = '' OR trim(coalesce(p_pin, '')) = '' THEN
    RAISE EXCEPTION 'code_or_pin_required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = (
    SELECT o.id
    FROM public.orders o
    WHERE o.order_code = v_digits
       OR o.order_code = '#YACH-' || lpad(right(v_digits, 4), 4, '0')
       OR regexp_replace(o.order_code, '[^0-9]', '', 'g') = v_digits
    ORDER BY
      CASE WHEN o.order_code = v_digits THEN 0 ELSE 1 END,
      o.created_at DESC
    LIMIT 1
  )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  IF v_store.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_store_owner';
  END IF;

  IF v_order.status = 'completed' THEN
    order_id := v_order.id;
    order_code := v_order.order_code;
    status := v_order.status;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.deposit_status <> 'paid' OR v_order.status <> 'deposit_paid' THEN
    RAISE EXCEPTION 'deposit_not_paid';
  END IF;

  IF lpad(trim(coalesce(v_order.verification_pin, '')), 4, '0') IS DISTINCT FROM v_pin THEN
    RAISE EXCEPTION 'invalid_pin';
  END IF;

  UPDATE public.orders AS o
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE o.id = v_order.id
  RETURNING * INTO v_order;

  UPDATE public.material_requests AS mr
  SET status = 'completed', updated_at = now()
  WHERE mr.id = v_quote.request_id
    AND mr.status IN ('accepted', 'quoted', 'sent');

  PERFORM public.enqueue_store_push(
    v_quote.store_id,
    'order_completed',
    'YaChanga',
    'Pedido ' || coalesce(v_order.order_code, '') || ' cerrado con PIN.',
    jsonb_build_object(
      'type', 'store_board',
      'column', 'cerradas',
      'orderId', v_order.id,
      'orderCode', v_order.order_code,
      'quoteId', v_quote.id,
      'requestId', v_quote.request_id
    )
  );

  order_id := v_order.id;
  order_code := v_order.order_code;
  status := v_order.status;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.completar_orden_material_con_pin(text, text)
  TO authenticated, service_role;
