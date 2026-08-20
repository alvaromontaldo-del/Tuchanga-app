-- Asegurar PIN de retiro al cliente cuando el fee de materiales está pagado.

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
  v_pin text;
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

  IF v_revealed THEN
    v_pin := coalesce(nullif(btrim(v_order.verification_pin), ''), public.generar_pin_verificacion());
    UPDATE public.orders
    SET
      contact_revealed_at = coalesce(contact_revealed_at, now()),
      verification_pin = v_pin,
      order_code = CASE
        WHEN btrim(coalesce(order_code, '')) = '' THEN public.generate_store_order_code()
        ELSE order_code
      END,
      deposit_status = CASE
        WHEN deposit_status = 'waived' THEN 'waived'
        WHEN status = 'completed' THEN deposit_status
        ELSE 'paid'
      END,
      status = CASE
        WHEN status = 'completed' THEN 'completed'
        ELSE 'deposit_paid'
      END,
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
  verification_pin := CASE WHEN v_revealed THEN lpad(btrim(coalesce(v_order.verification_pin, '')), 4, '0') ELSE NULL END;
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

CREATE OR REPLACE FUNCTION public._mark_material_order_fee_paid(p_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_pin text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  v_pin := coalesce(nullif(btrim(v_order.verification_pin), ''), public.generar_pin_verificacion());

  IF v_order.deposit_status = 'paid' AND v_order.status IN ('deposit_paid', 'completed') THEN
    UPDATE public.orders
    SET
      verification_pin = v_pin,
      order_code = CASE
        WHEN btrim(coalesce(order_code, '')) = '' THEN public.generate_store_order_code()
        ELSE order_code
      END,
      updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;
    RETURN v_order;
  END IF;

  IF v_order.status NOT IN ('pending_deposit', 'pending') OR v_order.deposit_status <> 'pending' THEN
    RAISE EXCEPTION 'order_not_awaiting_deposit';
  END IF;

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

  RETURN v_order;
END;
$$;

UPDATE public.orders
SET
  verification_pin = public.generar_pin_verificacion(),
  updated_at = now()
WHERE btrim(coalesce(verification_pin, '')) = ''
  AND (
    deposit_status IN ('paid', 'waived')
    OR status IN ('deposit_paid', 'completed')
    OR contact_revealed_at IS NOT NULL
  );
