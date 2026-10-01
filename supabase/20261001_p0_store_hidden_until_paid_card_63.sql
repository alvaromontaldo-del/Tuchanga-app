-- YaChanga P0 #63 — Comercio oculto hasta pagar. Fase 1 (aditiva) + fase 2 comentada.
--
-- NO aplicar la fase 2 en el mismo paso que este archivo.
-- NO aplicar este archivo a producción desde el agente: lo corre un revisor.
-- Orden:
--   1. Ejecutar solo el bloque FASE 1 (este archivo, hasta el COMMIT).
--   2. Publicar el OTA con la app que ya no selecciona stores.phone,
--      stores.address ni orders.verification_pin.
--   3. Recién entonces descomentar y ejecutar FASE 2.
--
-- FASE 1 no revoca privilegios de columnas. Reafirma RPCs SECURITY DEFINER:
--   get_material_order_reveal(uuid)           teléfono, dirección y PIN del
--                                             comercio, solo para el cliente
--                                             de la orden y solo con fee aprobado
--   list_material_request_quote_reveals(uuid) lo mismo, en lote, al comparar
--   list_my_material_solicitudes()            retiros del cliente; el PIN solo
--                                             si auth.uid() es el cliente
--   get_my_store_contact(uuid)                teléfono y dirección del propio
--                                             comercio (dueño). Nunca un PIN.
--
-- El comercio no lee el PIN: lo tipea el cliente en completar_orden_material_con_pin.
-- EXECUTE queda solo para authenticated. Sin anon y sin service_role.
-- El webhook de Mercado Pago sigue con service_role y no usa estos RPC.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Dueño del comercio: su propio teléfono y dirección. Sin PIN de órdenes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_store_contact(p_store_id uuid)
RETURNS TABLE (
  phone text,
  address text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_store_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.phone, s.address
  FROM public.stores s
  WHERE s.id = p_store_id
    AND s.user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.get_my_store_contact(uuid) IS
  'Teléfono y dirección del comercio solo si auth.uid() es stores.user_id. No devuelve PIN de órdenes.';

REVOKE ALL ON FUNCTION public.get_my_store_contact(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_store_contact(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_store_contact(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_my_store_contact(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Reveal de una orden. Misma regla que la migración 20260820180000:
--    el caller tiene que ser el cliente (no el comercio) y los campos
--    sensibles salen solo con fee aprobado.
--    Fee aprobado = deposit_status paid/waived, status deposit_paid/completed
--    o contact_revealed_at.
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
  v_pin text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  -- Dueño del comercio: not_order_client. El PIN no se le devuelve.
  IF NOT public._material_order_payer_can_reveal(p_order_id, v_uid) THEN
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

  order_id := v_order.id;
  order_code := CASE WHEN v_revealed THEN v_order.order_code ELSE NULL END;
  status := v_order.status;
  deposit_status := v_order.deposit_status;
  deposit_amount := v_order.deposit_amount;
  accepted_total := v_order.accepted_total;
  verification_pin := CASE
    WHEN v_revealed AND NOT public.is_store_owner(v_store.id)
    THEN lpad(btrim(coalesce(v_order.verification_pin, '')), 4, '0')
    ELSE NULL
  END;
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

COMMENT ON FUNCTION public.get_material_order_reveal(uuid) IS
  'Teléfono, dirección y PIN solo si auth.uid() es el cliente de la orden y el fee está aprobado. El comercio no puede llamarla.';

REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_material_order_reveal(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_material_order_reveal(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Reveal en lote (comparar cotizaciones). Teléfono, dirección y PIN
--    solo con fee aprobado y solo para el cliente de esa orden.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.list_material_request_quote_reveals(uuid);

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
      ) AND public._material_order_payer_can_reveal(o.id, v_uid)
      THEN s.phone
      ELSE NULL
    END AS store_phone,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) AND public._material_order_payer_can_reveal(o.id, v_uid)
      THEN s.address
      ELSE NULL
    END AS store_address,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) AND public._material_order_payer_can_reveal(o.id, v_uid)
      THEN o.order_code
      ELSE NULL
    END AS order_code,
    CASE
      WHEN (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      )
      AND public._material_order_payer_can_reveal(o.id, v_uid)
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
  'Teléfono, dirección, código y PIN de cada comercio del pedido. Sensibles solo con fee aprobado y solo si auth.uid() es el cliente de esa orden.';

REVOKE ALL ON FUNCTION public.list_material_request_quote_reveals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_material_request_quote_reveals(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_material_request_quote_reveals(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.list_material_request_quote_reveals(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Retiros del cliente. La dirección sale solo en órdenes ya pagas.
--    El PIN sale solo si el caller es el cliente, nunca el comercio.
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
      coalesce(nullif(trim(s.address), ''), '') AS store_address,
      coalesce(s.opening_hours, '[]'::jsonb) AS store_opening_hours,
      coalesce(o.contact_revealed_at, o.updated_at, o.created_at) AS available_at,
      o.completed_at,
      CASE
        WHEN public._material_order_payer_can_reveal(o.id, uid)
          AND NOT public.is_store_owner(q.store_id)
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
  'Pedidos de materiales ya pagos, para retirar o retirados. Dirección solo post-fee. PIN solo si auth.uid() es el cliente y no el dueño del comercio.';

REVOKE ALL ON FUNCTION public.list_my_material_solicitudes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_material_solicitudes() FROM anon;
REVOKE ALL ON FUNCTION public.list_my_material_solicitudes() FROM service_role;
GRANT EXECUTE ON FUNCTION public.list_my_material_solicitudes() TO authenticated;

COMMIT;

-- =============================================================================
-- FASE 2 — NO EJECUTAR hasta que el OTA con la fase 1 esté en producción.
--
-- El bloque de abajo está comentado a propósito. Descomentarlo y correrlo
-- solo después de verificar que la app ya no selecciona:
--   stores.phone, stores.address, orders.verification_pin
--
-- Un GRANT SELECT de tabla pisa un REVOKE de columna. Por eso se revoca el
-- SELECT de la tabla y se reotorga el resto de columnas, sin esas tres.
-- service_role no se toca: el webhook mp_retorno y los RPC SECURITY DEFINER
-- del owner siguen leyendo las columnas.
--
-- Antes de correr, confirmar que no apareció ninguna columna nueva:
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name IN ('stores', 'orders')
--   ORDER BY table_name, ordinal_position;
-- Si hay columnas de más, sumarlas al GRANT (nunca phone, address ni
-- verification_pin).
--
-- Realtime: la app no se suscribe a postgres_changes de orders/stores.
-- Si más adelante se publica la tabla, el payload de authenticated no debe
-- incluir las columnas revocadas. Probar que el tablero del comercio sigue
-- leyendo order_code, status y deposit_status.
-- =============================================================================
/*
BEGIN;

REVOKE SELECT ON TABLE public.stores FROM authenticated, anon;
GRANT SELECT (
  id,
  user_id,
  name,
  latitude,
  longitude,
  coverage_radius_km,
  status,
  trial_ends_at,
  created_at,
  updated_at,
  approved_at,
  approved_by,
  rejection_reason,
  avatar_url,
  opening_hours
) ON public.stores TO authenticated;

REVOKE SELECT ON TABLE public.orders FROM authenticated, anon;
GRANT SELECT (
  id,
  quote_id,
  order_code,
  status,
  created_at,
  updated_at,
  client_id,
  accepted_total,
  deposit_amount,
  deposit_status,
  contact_revealed_at,
  completed_at,
  payment_group_id,
  include_freight
) ON public.orders TO authenticated;

COMMIT;
*/
