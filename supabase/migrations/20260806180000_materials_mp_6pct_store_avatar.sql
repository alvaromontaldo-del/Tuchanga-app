-- Seña materiales 6% + MP + avatar de comercio separado del perfil persona.

-- 1) Tasa de seña YaChanga sobre materiales
CREATE OR REPLACE FUNCTION public.material_deposit_rate()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 0.06::numeric;
$$;

COMMENT ON FUNCTION public.material_deposit_rate() IS
  'Seña YaChanga sobre materiales: 6% del total aceptado (CEIL en accept_material_quote).';

-- Recalcular seña pendiente con la nueva tasa
UPDATE public.orders
SET
  deposit_amount = GREATEST(public.ceil_money(COALESCE(accepted_total, 0) * public.material_deposit_rate()), 1),
  updated_at = now()
WHERE deposit_status = 'pending'
  AND status IN ('pending_deposit', 'pending')
  AND COALESCE(accepted_total, 0) > 0;

-- 2) Avatar del comercio (independiente de profiles.avatar_url)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.stores.avatar_url IS
  'Foto/logo del comercio; no comparte profiles.avatar_url del usuario.';

CREATE OR REPLACE FUNCTION public.set_my_store_avatar_url(p_store_id uuid, p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_store_owner(p_store_id) THEN
    RAISE EXCEPTION 'not_store_owner';
  END IF;
  UPDATE public.stores
  SET avatar_url = nullif(btrim(p_url), ''),
      updated_at = now()
  WHERE id = p_store_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_store_avatar_url(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_store_avatar_url(uuid, text) TO authenticated, service_role;

-- 3) Soporte MP para seña de materiales
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'transaccion_tipo_pago'
      AND e.enumlabel = 'seña_materiales'
  ) THEN
    ALTER TYPE public.transaccion_tipo_pago ADD VALUE 'seña_materiales';
  END IF;
END
$$;

ALTER TABLE public.transacciones_pago
  ALTER COLUMN contratacion_id DROP NOT NULL;

ALTER TABLE public.transacciones_pago
  ADD COLUMN IF NOT EXISTS material_order_id uuid REFERENCES public.orders (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_transacciones_pago_material_order
  ON public.transacciones_pago (material_order_id, created_at DESC)
  WHERE material_order_id IS NOT NULL;

ALTER TABLE public.transacciones_pago
  DROP CONSTRAINT IF EXISTS transacciones_pago_ref_check;

ALTER TABLE public.transacciones_pago
  ADD CONSTRAINT transacciones_pago_ref_check CHECK (
    (contratacion_id IS NOT NULL AND material_order_id IS NULL)
    OR (contratacion_id IS NULL AND material_order_id IS NOT NULL)
  );

-- 4) Registrar seña materiales aprobada (service_role / webhook)
CREATE OR REPLACE FUNCTION public.registrar_sena_material_aprobada(
  p_order_id uuid,
  p_monto numeric,
  p_mp_payment_id text,
  p_mp_preference_id text,
  p_idempotency_key text,
  p_external_reference text
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
  v_existing uuid;
BEGIN
  IF p_order_id IS NULL OR btrim(coalesce(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;

  SELECT id INTO v_existing
  FROM public.transacciones_pago
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN; -- idempotente
  END IF;

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
  SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  SELECT * INTO v_req FROM public.material_requests WHERE id = v_quote.request_id;

  IF v_req.conversation_id IS NOT NULL THEN
    PERFORM public._chat_insert_system_event(
      v_req.conversation_id,
      v_order.client_id,
      'Seña de materiales acreditada. Ya podés ver el comercio, el código y el PIN.',
      jsonb_build_object(
        'event', 'material_sena_pagada',
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
