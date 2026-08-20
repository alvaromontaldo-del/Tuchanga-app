-- YaChanga — Cliente dueño de la orden puede leer orders (RLS) y
-- batch-reveal de comercios en comparación de cotizaciones.

-- ---------------------------------------------------------------------------
-- 1) orders SELECT: client_id directo + quotes.client_id (legado sin mr.client_id)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.id = quote_id
      AND (
        public.is_store_owner(q.store_id)
        OR public.is_material_request_party(q.request_id)
        OR q.client_id = auth.uid()
      )
  )
);

-- ---------------------------------------------------------------------------
-- 2) RPC: revelar comercios de un pedido (comparación post-pago)
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
  store_address text
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
      o.deposit_status = 'paid'
      OR o.status IN ('deposit_paid', 'completed')
      OR o.contact_revealed_at IS NOT NULL
    ) AS contact_revealed,
    CASE
      WHEN (
        o.deposit_status = 'paid'
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) THEN coalesce(nullif(trim(s.name), ''), 'Comercio')
      ELSE NULL
    END AS store_name,
    CASE
      WHEN (
        o.deposit_status = 'paid'
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) THEN s.phone
      ELSE NULL
    END AS store_phone,
    CASE
      WHEN (
        o.deposit_status = 'paid'
        OR o.status IN ('deposit_paid', 'completed')
        OR o.contact_revealed_at IS NOT NULL
      ) THEN s.address
      ELSE NULL
    END AS store_address
  FROM public.quotes q
  JOIN public.orders o ON o.quote_id = q.id
  JOIN public.stores s ON s.id = q.store_id
  WHERE q.request_id = p_request_id
    AND q.status = 'accepted';
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_material_request_quote_reveals(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_material_request_quote_reveals(uuid) IS
  'Batch reveal de comercios post-pago para comparación de cotizaciones.';
