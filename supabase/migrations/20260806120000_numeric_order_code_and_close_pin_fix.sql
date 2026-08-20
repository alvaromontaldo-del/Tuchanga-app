-- Códigos de orden solo numéricos + cierre con PIN robusto (lpad + lookup flexible).
-- IMPORTANTE: dropear el CHECK viejo ANTES de migrar los códigos.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_code_format;

-- Migrar códigos legacy #YACH-NNNN → NNNN
UPDATE public.orders
SET order_code = regexp_replace(order_code, '[^0-9]', '', 'g')
WHERE order_code ~ '[^0-9]';

-- Evitar vacíos / no numéricos
UPDATE public.orders
SET order_code = lpad((floor(random() * 10000))::int::text, 4, '0')
WHERE btrim(coalesce(order_code, '')) = ''
   OR order_code !~ '^[0-9]+$';

-- Si quedó con menos de 4 dígitos, pad
UPDATE public.orders
SET order_code = lpad(order_code, 4, '0')
WHERE length(order_code) < 4;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_code_format CHECK (order_code ~ '^[0-9]{4,6}$');

-- Generador numérico (4 dígitos)
CREATE OR REPLACE FUNCTION public.generate_store_order_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
  v_code text;
  v_tries int := 0;
BEGIN
  LOOP
    v_tries := v_tries + 1;
    IF v_tries > 40 THEN
      RAISE EXCEPTION 'No se pudo generar order_code único';
    END IF;
    v_n := floor(random() * 10000)::int;
    v_code := lpad(v_n::text, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders o WHERE o.order_code = v_code
    );
  END LOOP;
  RETURN v_code;
END;
$$;

COMMENT ON FUNCTION public.generate_store_order_code() IS
  'Genera order_code numérico de 4 dígitos (ej. 04192).';

-- Cierre: acepta 4192 / #YACH-4192 y PIN con ceros a la izquierda
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

  UPDATE public.orders
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  UPDATE public.material_requests
  SET status = 'completed', updated_at = now()
  WHERE id = v_quote.request_id
    AND status IN ('accepted', 'quoted', 'sent');

  order_id := v_order.id;
  order_code := v_order.order_code;
  status := v_order.status;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.completar_orden_material_con_pin(text, text) TO authenticated, service_role;
