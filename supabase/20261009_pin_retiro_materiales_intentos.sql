-- YaChanga — PIN de retiro de materiales: 5 fallos, bloqueo 15 minutos.
--
-- NO APLICADO. Probar dentro de BEGIN … ROLLBACK.
-- Cuerpo de completar_orden_material_con_pin_v2 reconstruido desde
-- pg_get_functiondef('public.completar_orden_material_con_pin(text, text)')
-- en producción el 2026-10-09. Guards, búsqueda de código, push y grants
-- de la original se conservan. anon no tiene EXECUTE.
--
-- La RPC original sigue haciendo RAISE 'invalid_pin'. Si pasara a devolver
-- una fila, la app ya publicada la tomaría como orden cerrada. Por eso el
-- contador vive en completar_orden_material_con_pin_v2: actualiza y
-- devuelve status invalid_pin o pin_bloqueado, sin RAISE, igual que el
-- 5º fallo de verificar_pin (un RAISE en la misma transacción desharía
-- el UPDATE).
--
-- La v2 no devuelve verification_pin. El comercio sigue tipeándolo.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pin_intentos_fallidos int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_bloqueado_hasta timestamptz;

COMMENT ON COLUMN public.orders.pin_intentos_fallidos IS
  'Fallos seguidos del PIN de retiro. Solo lo escribe completar_orden_material_con_pin_v2.';
COMMENT ON COLUMN public.orders.pin_bloqueado_hasta IS
  'Fin del bloqueo de 15 minutos tras 5 PIN de retiro fallidos.';

CREATE OR REPLACE FUNCTION public.completar_orden_material_con_pin_v2(p_order_code text, p_pin text)
 RETURNS TABLE(order_id uuid, order_code text, status text, pin_intentos_fallidos int, pin_bloqueado_hasta timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_raw text := upper(trim(coalesce(p_order_code, '')));
  v_digits text := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_pin text := lpad(trim(coalesce(p_pin, '')), 4, '0');
  v_next int;
  v_until timestamptz;
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
    pin_intentos_fallidos := v_order.pin_intentos_fallidos;
    pin_bloqueado_hasta := v_order.pin_bloqueado_hasta;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.deposit_status <> 'paid' OR v_order.status <> 'deposit_paid' THEN
    RAISE EXCEPTION 'deposit_not_paid';
  END IF;

  IF v_order.pin_bloqueado_hasta IS NOT NULL AND v_order.pin_bloqueado_hasta > now() THEN
    order_id := v_order.id;
    order_code := v_order.order_code;
    status := 'pin_bloqueado';
    pin_intentos_fallidos := v_order.pin_intentos_fallidos;
    pin_bloqueado_hasta := v_order.pin_bloqueado_hasta;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.pin_bloqueado_hasta IS NOT NULL AND v_order.pin_bloqueado_hasta <= now() THEN
    UPDATE public.orders AS o
    SET
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL,
      updated_at = now()
    WHERE o.id = v_order.id;
    v_order.pin_intentos_fallidos := 0;
    v_order.pin_bloqueado_hasta := NULL;
  END IF;

  IF lpad(trim(coalesce(v_order.verification_pin, '')), 4, '0') IS DISTINCT FROM v_pin THEN
    v_next := coalesce(v_order.pin_intentos_fallidos, 0) + 1;
    v_until := CASE
      WHEN v_next >= 5 THEN now() + interval '15 minutes'
      ELSE v_order.pin_bloqueado_hasta
    END;

    UPDATE public.orders AS o
    SET
      pin_intentos_fallidos = v_next,
      pin_bloqueado_hasta = v_until,
      updated_at = now()
    WHERE o.id = v_order.id;

    order_id := v_order.id;
    order_code := v_order.order_code;
    status := CASE WHEN v_next >= 5 THEN 'pin_bloqueado' ELSE 'invalid_pin' END;
    pin_intentos_fallidos := v_next;
    pin_bloqueado_hasta := v_until;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.orders AS o
  SET
    status = 'completed',
    completed_at = now(),
    updated_at = now(),
    pin_intentos_fallidos = 0,
    pin_bloqueado_hasta = NULL
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
  pin_intentos_fallidos := v_order.pin_intentos_fallidos;
  pin_bloqueado_hasta := v_order.pin_bloqueado_hasta;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.completar_orden_material_con_pin_v2(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.completar_orden_material_con_pin_v2(text, text) TO authenticated, service_role;

COMMIT;
