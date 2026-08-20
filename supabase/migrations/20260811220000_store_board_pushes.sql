-- YaChanga — Push al dueño del comercio en cambios de estado del Kanban.
--
-- Cola `store_push_events` + helpers. La Edge Function `push_on_store_board`
-- consume INSERT (Database Webhook o invoke). También se encola desde RPCs.
--
-- Dashboard (recomendado):
--   Table: store_push_events | Events: INSERT
--   Function: push_on_store_board | verify_jwt = false
--   npx supabase functions deploy push_on_store_board --no-verify-jwt

CREATE TABLE IF NOT EXISTS public.store_push_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_push_events_created
  ON public.store_push_events (created_at DESC);

ALTER TABLE public.store_push_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_push_events_service ON public.store_push_events;
-- Solo service_role / SECURITY DEFINER escriben; dueños pueden leer lo propio.
CREATE POLICY store_push_events_select_owner ON public.store_push_events
FOR SELECT TO authenticated
USING (public.is_store_owner(store_id));

GRANT SELECT ON public.store_push_events TO authenticated;
GRANT ALL ON public.store_push_events TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_store_push(
  p_store_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_store_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.store_push_events (store_id, event_type, title, body, data)
  VALUES (
    p_store_id,
    left(coalesce(p_event_type, 'store_board'), 64),
    left(coalesce(nullif(trim(p_title), ''), 'YaChanga'), 120),
    left(coalesce(nullif(trim(p_body), ''), 'Actualización de pedido'), 240),
    coalesce(p_data, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_store_push(uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_store_push(uuid, text, text, text, jsonb)
  TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Nueva solicitud → push al comercio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_request_target_store_push_new()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_store_push(
    NEW.store_id,
    'nueva_solicitud',
    'YaChanga',
    'Tenés una nueva solicitud de cotización.',
    jsonb_build_object(
      'type', 'store_board',
      'column', 'nuevas',
      'requestId', NEW.request_id,
      'targetId', NEW.id
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_request_target_store_push_new ON public.request_target_stores;
CREATE TRIGGER trg_request_target_store_push_new
AFTER INSERT ON public.request_target_stores
FOR EACH ROW
EXECUTE FUNCTION public.trg_request_target_store_push_new();

-- ---------------------------------------------------------------------------
-- Rechazo total → push
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

  UPDATE public.quote_items
  SET client_decision = 'rejected'
  WHERE quote_id = p_quote_id
    AND client_decision = 'pending';

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

-- ---------------------------------------------------------------------------
-- Fee pagado → Confirmadas (push) + asegurar order_code
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
  'Marca fee materiales pagado (deposit_paid). Push al comercio. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Cierre con PIN → push
-- ---------------------------------------------------------------------------
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

COMMENT ON TABLE public.store_push_events IS
  'Cola de pushes al dueño del comercio. Webhook → Edge push_on_store_board.';
