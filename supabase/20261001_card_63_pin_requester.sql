-- YaChanga — seguimiento de #63. El PIN de retiro también lo ve quien creó la solicitud.
--
-- APLICADO en producción el 2026-10-01 (migración card_63_pin_requester), después de la fase 2 de #63.
-- Reemplaza solo los tres RPC de revelado de
-- supabase/20261001_p0_store_hidden_until_paid_card_63.sql.
-- No toca get_my_store_contact ni completar_orden_material_con_pin:
-- el dueño del comercio sigue tipeando el PIN, nunca lo lee.
--
-- Creador del pedido: material_requests.professional_id.
-- La app lo carga con el perfil que envía la solicitud (CreateMaterialRequest).
-- El cliente que paga sigue siendo orders.client_id / quotes.client_id /
-- material_checkouts.client_id / material_requests.client_id
-- (_material_order_payer_can_reveal).
--
-- PIN, teléfono y dirección del comercio salen solo con el fee aprobado, y solo si
-- auth.uid() es (a) ese cliente o (b) professional_id. Si el caller es el dueño
-- de ESE comercio (is_store_owner), los tres vuelven null aunque también sea
-- el creador: autocompra, el PIN queda oculto.
--
-- Guards que se mantienen: not_authenticated, order_not_found,
-- not_order_client, request_not_found, not_request_party.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Reveal de una orden.
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
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_material_order_reveal(uuid) IS
  'Teléfono, dirección y PIN con fee aprobado, para el cliente que pagó o material_requests.professional_id. Null si auth.uid() es el dueño de ese comercio.';

REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_material_order_reveal(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Reveal en lote (comparar cotizaciones).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_material_request_quote_reveals(p_request_id uuid)
RETURNS TABLE (
  quote_id uuid,
  order_id uuid,
  deposit_status text,
  order_status text,
  contact_revealed boolean,
  store_name text,
  store_phone text,
  store_address text,
  order_code text,
  verification_pin text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.material_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_req FROM public.material_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF v_req.client_id IS DISTINCT FROM v_uid
     AND v_req.professional_id IS DISTINCT FROM v_uid
     AND NOT EXISTS (
       SELECT 1 FROM public.quotes q
       WHERE q.request_id = p_request_id AND q.client_id = v_uid
     )
  THEN
    RAISE EXCEPTION 'not_request_party';
  END IF;

  RETURN QUERY
  SELECT
    q.id AS quote_id,
    o.id AS order_id,
    o.deposit_status::text,
    o.status::text AS order_status,
    (
      o.deposit_status IN ('paid', 'waived')
      OR o.status IN ('deposit_paid', 'completed')
      OR o.contact_revealed_at IS NOT NULL
    ) AS contact_revealed,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) THEN coalesce(nullif(trim(s.name), ''), 'Comercio')
      ELSE NULL
    END AS store_name,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
      AND (
        public._material_order_payer_can_reveal(o.id, v_uid)
        OR v_req.professional_id = v_uid
      )
      AND NOT public.is_store_owner(q.store_id)
      THEN s.phone
      ELSE NULL
    END AS store_phone,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
      AND (
        public._material_order_payer_can_reveal(o.id, v_uid)
        OR v_req.professional_id = v_uid
      )
      AND NOT public.is_store_owner(q.store_id)
      THEN s.address
      ELSE NULL
    END AS store_address,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
      AND (
        public._material_order_payer_can_reveal(o.id, v_uid)
        OR v_req.professional_id = v_uid
      )
      THEN o.order_code
      ELSE NULL
    END AS order_code,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
      AND (
        public._material_order_payer_can_reveal(o.id, v_uid)
        OR v_req.professional_id = v_uid
      )
      AND NOT public.is_store_owner(q.store_id)
      AND nullif(btrim(coalesce(o.verification_pin, '')), '') IS NOT NULL
      THEN lpad(btrim(o.verification_pin), 4, '0')
      ELSE NULL
    END AS verification_pin
  FROM public.quotes q
  JOIN public.orders o ON o.quote_id = q.id
  JOIN public.stores s ON s.id = q.store_id
  WHERE q.request_id = p_request_id
    AND (
      q.status = 'accepted'
      OR o.deposit_status IN ('paid', 'waived')
      OR o.status IN ('deposit_paid', 'completed')
      OR o.contact_revealed_at IS NOT NULL
    );
END;
$$;

COMMENT ON FUNCTION public.list_material_request_quote_reveals(uuid) IS
  'Teléfono, dirección y PIN de cada comercio con fee aprobado, para el cliente que pagó o el professional_id de la solicitud. Null si el caller es dueño de ese comercio.';

REVOKE ALL ON FUNCTION public.list_material_request_quote_reveals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_material_request_quote_reveals(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_material_request_quote_reveals(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.list_material_request_quote_reveals(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Mis pedidos de materiales. La lista ya está filtrada a fee aprobado.
--    PIN, teléfono y dirección: cliente que pagó o professional_id, nunca el dueño.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_my_material_solicitudes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      o.id AS order_id,
      mr.id AS request_id,
      upper(left(replace(mr.id::text, '-', ''), 8)) AS numero_solicitud,
      regexp_replace(coalesce(o.order_code, ''), '[^0-9]', '', 'g') AS numero_pedido,
      o.order_code,
      coalesce(nullif(trim(mr.title), ''), 'Pedido de materiales') AS title,
      coalesce(nullif(trim(s.name), ''), 'Comercio') AS store_name,
      CASE
        WHEN NOT public.is_store_owner(q.store_id)
          AND (
            public._material_order_payer_can_reveal(o.id, uid)
            OR mr.professional_id = uid
          )
        THEN coalesce(nullif(trim(s.address), ''), '')
        ELSE NULL
      END AS store_address,
      CASE
        WHEN NOT public.is_store_owner(q.store_id)
          AND (
            public._material_order_payer_can_reveal(o.id, uid)
            OR mr.professional_id = uid
          )
        THEN nullif(btrim(coalesce(s.phone, '')), '')
        ELSE NULL
      END AS store_phone,
      coalesce(s.opening_hours, '[]'::jsonb) AS store_opening_hours,
      coalesce(o.contact_revealed_at, o.updated_at, o.created_at) AS available_at,
      o.completed_at,
      CASE
        WHEN NOT public.is_store_owner(q.store_id)
          AND (
            public._material_order_payer_can_reveal(o.id, uid)
            OR mr.professional_id = uid
          )
          AND nullif(btrim(coalesce(o.verification_pin, '')), '') IS NOT NULL
        THEN lpad(btrim(o.verification_pin), 4, '0')
        ELSE NULL
      END AS verification_pin,
      o.accepted_total,
      coalesce(o.include_freight, true) AS include_freight,
      q.freight_type,
      q.freight_cost,
      o.status AS order_status,
      o.deposit_status,
      CASE
        WHEN o.status = 'completed' THEN 'historial'
        ELSE 'activa'
      END AS list_bucket,
      CASE
        WHEN o.status = 'completed' THEN coalesce(o.completed_at, o.updated_at, o.created_at)
        ELSE coalesce(o.contact_revealed_at, o.updated_at, o.created_at)
      END AS sort_at,
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', qi.id,
              'request_item_id', ri.id,
              'description', ri.description,
              'quantity', ri.quantity,
              'unit', ri.unit,
              'sort_order', ri.sort_order,
              'sortOrder', ri.sort_order,
              'client_decision', qi.client_decision,
              'variant_label', nullif(btrim(coalesce(qi.variant_label, '')), ''),
              'alternative_description', nullif(btrim(coalesce(qi.alternative_description, '')), ''),
              'in_stock', qi.in_stock,
              'brand', CASE
                WHEN qi.in_stock IS FALSE
                  THEN nullif(btrim(coalesce(qi.alternative_description, qi.variant_label, '')), '')
                ELSE nullif(btrim(coalesce(qi.variant_label, '')), '')
              END
            )
            ORDER BY ri.sort_order, ri.created_at, qi.variant_index, qi.created_at
          )
          FROM public.quote_items qi
          JOIN public.request_items ri ON ri.id = qi.request_item_id
          WHERE qi.quote_id = q.id
            AND qi.client_decision = 'accepted'
        ),
        '[]'::jsonb
      ) AS items
    FROM public.orders o
    JOIN public.quotes q ON q.id = o.quote_id
    JOIN public.material_requests mr ON mr.id = q.request_id
    JOIN public.stores s ON s.id = q.store_id
    WHERE coalesce(o.status, '') IS DISTINCT FROM 'cancelled'
      AND o.deposit_status IN ('paid', 'waived')
      AND (
        o.status = 'deposit_paid'
        OR o.status = 'completed'
      )
      AND nullif(btrim(coalesce(o.verification_pin, '')), '') IS NOT NULL
      AND nullif(btrim(coalesce(o.order_code, '')), '') IS NOT NULL
      AND (
        mr.client_id = uid
        OR mr.professional_id = uid
        OR q.client_id = uid
        OR o.client_id = uid
      )
  ) x;

  RETURN v_rows;
END;
$function$;

COMMENT ON FUNCTION public.list_my_material_solicitudes() IS
  'Pedidos de materiales ya pagos. PIN, teléfono y dirección si auth.uid() es el cliente que pagó o professional_id, y no el dueño de ese comercio.';

REVOKE ALL ON FUNCTION public.list_my_material_solicitudes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_material_solicitudes() FROM anon;
REVOKE ALL ON FUNCTION public.list_my_material_solicitudes() FROM service_role;
GRANT EXECUTE ON FUNCTION public.list_my_material_solicitudes() TO authenticated;

COMMIT;
