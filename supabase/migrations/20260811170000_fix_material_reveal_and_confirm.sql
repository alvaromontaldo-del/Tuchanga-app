-- YaChanga — Revelar comercio tras pagar costo de servicio (serviceFee),
-- aunque contact_revealed_at haya quedado null; backfill + Kanban confirmadas.

-- Órdenes ya pagadas sin timestamp de revelación.
UPDATE public.orders
SET contact_revealed_at = coalesce(contact_revealed_at, now()),
    updated_at = now()
WHERE deposit_status = 'paid'
  AND contact_revealed_at IS NULL;

UPDATE public.orders
SET contact_revealed_at = coalesce(contact_revealed_at, now()),
    updated_at = now()
WHERE status IN ('deposit_paid', 'completed')
  AND contact_revealed_at IS NULL;

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

  -- Costo de servicio pagado (o orden ya confirmada/cerrada) = revelar,
  -- sin exigir contact_revealed_at (legacy / race con webhooks).
  v_revealed :=
    v_order.deposit_status = 'paid'
    OR v_order.status IN ('deposit_paid', 'completed');

  IF v_revealed AND v_order.contact_revealed_at IS NULL THEN
    UPDATE public.orders
    SET contact_revealed_at = now(),
        updated_at = now()
    WHERE id = v_order.id
      AND contact_revealed_at IS NULL
    RETURNING * INTO v_order;
  END IF;

  order_id := v_order.id;
  order_code := CASE WHEN v_revealed THEN v_order.order_code ELSE NULL END;
  status := v_order.status;
  deposit_status := v_order.deposit_status;
  deposit_amount := v_order.deposit_amount;
  accepted_total := v_order.accepted_total;
  verification_pin := CASE WHEN v_revealed THEN v_order.verification_pin ELSE NULL END;
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

GRANT EXECUTE ON FUNCTION public.get_material_order_reveal(uuid) TO authenticated, service_role;
