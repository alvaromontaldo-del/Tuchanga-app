-- YaChanga #48 — horario del comercio al volver del pago de materiales.
--
-- get_material_order_reveal cambia el RETURNS TABLE (suma store_opening_hours).
-- CREATE OR REPLACE no puede alterar columnas de salida: hay que dropear.
-- El resto del contrato no cambia: PIN, teléfono y dirección siguen null
-- si auth.uid() es el dueño de ese comercio.
--
-- El horario es stores.opening_hours tal cual. No se inventa.
-- Sale solo con el costo de servicio acreditado (mismo gate que el nombre).
-- Antes del pago vuelve null. Si el comercio no cargó horario, vuelve
-- el jsonb guardado (a menudo []) y la app muestra «No especificado».

BEGIN;

DROP FUNCTION IF EXISTS public.get_material_order_reveal(uuid);

CREATE FUNCTION public.get_material_order_reveal(p_order_id uuid)
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
  contact_revealed boolean,
  store_opening_hours jsonb
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
  v_is_payer boolean;
  v_is_requester boolean;
  v_show_pickup boolean;
  v_pin text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  v_is_payer := public._material_order_payer_can_reveal(p_order_id, v_uid);
  SELECT EXISTS (
    SELECT 1
    FROM public.quotes q
    JOIN public.material_requests mr ON mr.id = q.request_id
    WHERE q.id = v_order.quote_id
      AND mr.professional_id = v_uid
  ) INTO v_is_requester;

  -- Dueño que no pagó ni creó el pedido: not_order_client. No ve el PIN.
  IF NOT v_is_payer AND NOT v_is_requester THEN
    RAISE EXCEPTION 'not_order_client';
  END IF;

  IF v_order.client_id IS DISTINCT FROM v_uid THEN
    IF EXISTS (
      SELECT 1
      FROM public.material_checkouts mc
      WHERE mc.id = v_order.payment_group_id
        AND mc.client_id = v_uid
    ) OR EXISTS (
      SELECT 1
      FROM public.quotes q
      WHERE q.id = v_order.quote_id
        AND q.client_id = v_uid
    ) THEN
      UPDATE public.orders
      SET client_id = v_uid, updated_at = now()
      WHERE id = p_order_id
      RETURNING * INTO v_order;
    END IF;
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_order.quote_id;
  IF FOUND THEN
    SELECT * INTO v_store FROM public.stores WHERE id = v_quote.store_id;
  END IF;

  v_revealed :=
    v_order.deposit_status IN ('paid', 'waived')
    OR v_order.status IN ('deposit_paid', 'completed')
    OR v_order.contact_revealed_at IS NOT NULL;

  IF v_revealed THEN
    v_pin := coalesce(nullif(btrim(v_order.verification_pin), ''), public.generar_pin_verificacion());
    UPDATE public.orders AS o
    SET
      contact_revealed_at = coalesce(o.contact_revealed_at, now()),
      verification_pin = v_pin,
      order_code = CASE
        WHEN btrim(coalesce(o.order_code, '')) = '' THEN public.generate_store_order_code()
        ELSE o.order_code
      END,
      deposit_status = CASE
        WHEN o.deposit_status = 'waived' THEN 'waived'
        WHEN o.status = 'completed' THEN o.deposit_status
        ELSE 'paid'
      END,
      status = CASE
        WHEN o.status = 'completed' THEN 'completed'
        ELSE 'deposit_paid'
      END,
      updated_at = now()
    WHERE o.id = v_order.id
    RETURNING * INTO v_order;
  END IF;

  -- Autocompra: el dueño de este comercio no recibe PIN, teléfono ni dirección.
  v_show_pickup :=
    v_revealed
    AND NOT public.is_store_owner(v_store.id)
    AND (v_is_payer OR v_is_requester);

  order_id := v_order.id;
  order_code := CASE WHEN v_revealed THEN v_order.order_code ELSE NULL END;
  status := v_order.status;
  deposit_status := v_order.deposit_status;
  deposit_amount := v_order.deposit_amount;
  accepted_total := v_order.accepted_total;
  verification_pin := CASE
    WHEN v_show_pickup THEN lpad(btrim(coalesce(v_order.verification_pin, '')), 4, '0')
    ELSE NULL
  END;
  store_name := CASE
    WHEN v_revealed THEN coalesce(nullif(trim(v_store.name), ''), 'Comercio')
    ELSE 'Comercio (oculto hasta pagar el costo de servicio)'
  END;
  store_phone := CASE WHEN v_show_pickup THEN v_store.phone ELSE NULL END;
  store_address := CASE WHEN v_show_pickup THEN v_store.address ELSE NULL END;
  contact_revealed := v_revealed;
  store_opening_hours := CASE WHEN v_revealed THEN v_store.opening_hours ELSE NULL END;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_material_order_reveal(uuid) IS
  'Teléfono, dirección y PIN con fee aprobado, para el cliente que pagó o material_requests.professional_id. Null si auth.uid() es el dueño de ese comercio. store_opening_hours es el horario guardado del comercio, solo tras acreditar el costo de servicio.';

REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_material_order_reveal(uuid) TO authenticated;

COMMIT;
