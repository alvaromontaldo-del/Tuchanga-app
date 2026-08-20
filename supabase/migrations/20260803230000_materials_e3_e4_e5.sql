-- =============================================================================
-- YaChanga — Materiales E3 / E4 / E5
-- E3: conversation_id + mensaje en chat al cotizar
-- E4: aceptación (ítems) + orden con seña pendiente
-- E5: revelar comercio + PIN al pagar seña; cierre con PIN
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) material_requests.conversation_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_material_requests_conversation
  ON public.material_requests (conversation_id)
  WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN public.material_requests.conversation_id IS
  'Chat cliente↔trabajador desde el que se originó la lista (E3).';

-- ---------------------------------------------------------------------------
-- 2) quote_items: decisión del cliente (aceptación parcial)
-- ---------------------------------------------------------------------------

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS client_decision text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_items_client_decision_check'
      AND conrelid = 'public.quote_items'::regclass
  ) THEN
    ALTER TABLE public.quote_items
      ADD CONSTRAINT quote_items_client_decision_check
      CHECK (client_decision IN ('pending', 'accepted', 'rejected'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) orders: seña, PIN, revelación
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (
    status IN (
      'pending',
      'pending_deposit',
      'deposit_paid',
      'completed',
      'cancelled'
    )
  );

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (accepted_total >= 0),
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'pending'
    CHECK (deposit_status IN ('pending', 'paid', 'waived')),
  ADD COLUMN IF NOT EXISTS verification_pin text,
  ADD COLUMN IF NOT EXISTS contact_revealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_client ON public.orders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_deposit ON public.orders (deposit_status, status);

COMMENT ON COLUMN public.orders.deposit_amount IS 'Seña a pagar (≈20% del total aceptado, CEIL).';
COMMENT ON COLUMN public.orders.verification_pin IS 'PIN de cierre; se genera al pagar la seña.';
COMMENT ON COLUMN public.orders.contact_revealed_at IS 'Cuándo se revelaron datos del comercio al cliente.';

-- ---------------------------------------------------------------------------
-- 4) Helper: % seña materiales
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.material_deposit_rate()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 0.20::numeric;
$$;

CREATE OR REPLACE FUNCTION public.ceil_money(p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ceil(greatest(coalesce(p_amount, 0), 0));
$$;

-- ---------------------------------------------------------------------------
-- 5) E3: notificar cotización en el chat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_material_quote_in_chat(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_quote public.quotes%ROWTYPE;
  v_req public.material_requests%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_total numeric := 0;
  v_msg_id uuid;
  v_body text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote_not_found';
  END IF;

  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  IF NOT FOUND OR v_store.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_store_owner';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;
  IF NOT FOUND OR v_req.conversation_id IS NULL THEN
    RETURN NULL; -- sin chat vinculado: ok silencioso
  END IF;

  SELECT coalesce(sum(qi.unit_price * ri.quantity), 0) INTO v_total
  FROM public.quote_items qi
  JOIN public.request_items ri ON ri.id = qi.request_item_id
  WHERE qi.quote_id = p_quote_id;

  IF v_quote.freight_type = 'cost' THEN
    v_total := v_total + coalesce(v_quote.freight_cost, 0);
  END IF;
  v_total := public.ceil_money(v_total);

  v_body := format(
    'Presupuesto de materiales de %s: %s. Tocá para ver el detalle.',
    coalesce(nullif(trim(v_store.name), ''), 'un comercio'),
    to_char(v_total, 'FM$999G999G990')
  );

  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    body,
    type,
    metadata
  ) VALUES (
    v_req.conversation_id,
    v_uid,
    v_body,
    'quotation',
    jsonb_build_object(
      'kind', 'material_quote',
      'quote_id', v_quote.id,
      'request_id', v_req.id,
      'store_id', v_store.id,
      'store_name', v_store.name,
      'total', v_total,
      'freight_type', v_quote.freight_type,
      'freight_cost', v_quote.freight_cost,
      'title', v_req.title
    )
  )
  RETURNING id INTO v_msg_id;

  RETURN v_msg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_material_quote_in_chat(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) E4: rechazar cotización
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

  UPDATE public.quotes
  SET status = 'rejected', updated_at = now()
  WHERE id = p_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_material_quote(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) E4: aceptar ítems + crear orden (seña pendiente, sin revelar)
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
  v_deposit numeric := 0;
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

  -- Evitar doble orden
  SELECT o.id INTO v_existing FROM public.orders o WHERE o.quote_id = p_quote_id;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'order_already_exists';
  END IF;

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
  ELSIF v_quote.freight_type = 'free' THEN
    NULL;
  END IF;
  -- pickup: sin flete extra

  v_total := public.ceil_money(v_total);
  v_deposit := public.ceil_money(v_total * public.material_deposit_rate());
  IF v_deposit < 1 THEN
    v_deposit := 1;
  END IF;

  UPDATE public.quotes
  SET status = 'accepted', updated_at = now()
  WHERE id = p_quote_id;

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
    v_deposit,
    'pending'
  )
  RETURNING id INTO v_order_id;

  order_id := v_order_id;
  deposit_amount := v_deposit;
  accepted_total := v_total;
  order_status := 'pending_deposit';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_material_quote(uuid, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) E5: confirmar seña → revelar + PIN + mensaje chat
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
    -- permitir service_role vía webhook: si no hay auth.uid check ya falló;
    -- cliente dueño solamente desde app
    RAISE EXCEPTION 'not_order_client';
  END IF;

  IF v_order.deposit_status = 'paid' AND v_order.status IN ('deposit_paid', 'completed') THEN
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
    updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

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
        'Seña de materiales pagada. Código %s. Datos del comercio disponibles.',
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

-- ---------------------------------------------------------------------------
-- 9) E5: comercio completa orden con PIN
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
  v_code text := upper(trim(coalesce(p_order_code, '')));
  v_pin text := trim(coalesce(p_pin, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF v_code = '' OR v_pin = '' THEN
    RAISE EXCEPTION 'code_or_pin_required';
  END IF;
  -- Normalizar #YACH-XXXX
  IF left(v_code, 1) <> '#' THEN
    v_code := '#' || v_code;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE order_code = v_code
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

  IF v_order.verification_pin IS DISTINCT FROM v_pin THEN
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

-- ---------------------------------------------------------------------------
-- 10) Lectura segura post-seña (cliente)
-- ---------------------------------------------------------------------------

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

  v_revealed := v_order.deposit_status = 'paid' AND v_order.contact_revealed_at IS NOT NULL;

  order_id := v_order.id;
  order_code := CASE WHEN v_revealed THEN v_order.order_code ELSE NULL END;
  status := v_order.status;
  deposit_status := v_order.deposit_status;
  deposit_amount := v_order.deposit_amount;
  accepted_total := v_order.accepted_total;
  verification_pin := CASE WHEN v_revealed THEN v_order.verification_pin ELSE NULL END;
  store_name := CASE WHEN v_revealed THEN v_store.name ELSE 'Comercio (oculto hasta pagar seña)' END;
  store_phone := CASE WHEN v_revealed THEN v_store.phone ELSE NULL END;
  store_address := CASE WHEN v_revealed THEN v_store.address ELSE NULL END;
  contact_revealed := v_revealed;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_material_order_reveal(uuid) TO authenticated, service_role;
