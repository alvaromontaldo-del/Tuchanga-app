-- =============================================================================
-- YaChanga — Módulo Comercios: Listas de Materiales y Cotización
-- Tablas: rubros, stores, store_rubros, material_requests, request_items,
--         quotes, quote_items, orders
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) rubros
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rubros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rubros_name_unique UNIQUE (name),
  CONSTRAINT rubros_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_rubros_name ON public.rubros (name);

-- ---------------------------------------------------------------------------
-- 2) stores
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  latitude double precision,
  longitude double precision,
  coverage_radius_km numeric(8, 2) NOT NULL DEFAULT 10
    CHECK (coverage_radius_km > 0 AND coverage_radius_km <= 500),
  status text NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'unpaid', 'paused')),
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stores_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT stores_lat_lng_pair CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude IS NOT NULL AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_stores_user ON public.stores (user_id);
CREATE INDEX IF NOT EXISTS idx_stores_status ON public.stores (status);
CREATE INDEX IF NOT EXISTS idx_stores_user_status ON public.stores (user_id, status);
CREATE INDEX IF NOT EXISTS idx_stores_geo ON public.stores (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) store_rubros (N:M)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.store_rubros (
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  rubro_id uuid NOT NULL REFERENCES public.rubros (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, rubro_id)
);

CREATE INDEX IF NOT EXISTS idx_store_rubros_rubro ON public.store_rubros (rubro_id);

-- ---------------------------------------------------------------------------
-- 4) material_requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  rubro_id uuid NOT NULL REFERENCES public.rubros (id) ON DELETE RESTRICT,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'quoted', 'accepted', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_requests_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT material_requests_has_party CHECK (
    professional_id IS NOT NULL OR client_id IS NOT NULL
  ),
  CONSTRAINT material_requests_parties_distinct CHECK (
    professional_id IS NULL
    OR client_id IS NULL
    OR professional_id <> client_id
  )
);

CREATE INDEX IF NOT EXISTS idx_material_requests_professional
  ON public.material_requests (professional_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_requests_client
  ON public.material_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_requests_rubro_status
  ON public.material_requests (rubro_id, status);
CREATE INDEX IF NOT EXISTS idx_material_requests_status_created
  ON public.material_requests (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5) request_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.material_requests (id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'u',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_items_description_not_blank CHECK (length(trim(description)) > 0),
  CONSTRAINT request_items_unit_not_blank CHECK (length(trim(unit)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_request_items_request
  ON public.request_items (request_id, sort_order);

-- ---------------------------------------------------------------------------
-- 6) quotes (cotizaciones de comercio ≠ ≠ contrataciones/chat)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.material_requests (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  freight_type text NOT NULL DEFAULT 'pickup'
    CHECK (freight_type IN ('pickup', 'free', 'cost')),
  freight_cost numeric(12, 2) NOT NULL DEFAULT 0 CHECK (freight_cost >= 0),
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotes_freight_cost_logic CHECK (
    (freight_type = 'cost' AND freight_cost >= 0)
    OR (freight_type IN ('pickup', 'free') AND freight_cost = 0)
  ),
  CONSTRAINT quotes_request_store_unique UNIQUE (request_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_quotes_request ON public.quotes (request_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_store ON public.quotes (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes (status);

-- ---------------------------------------------------------------------------
-- 7) quote_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes (id) ON DELETE CASCADE,
  request_item_id uuid NOT NULL REFERENCES public.request_items (id) ON DELETE CASCADE,
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_items_quote_request_item_unique UNIQUE (quote_id, request_item_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON public.quote_items (quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_request_item ON public.quote_items (request_item_id);

-- ---------------------------------------------------------------------------
-- 8) orders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL UNIQUE REFERENCES public.quotes (id) ON DELETE RESTRICT,
  order_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_order_code_unique UNIQUE (order_code),
  CONSTRAINT orders_order_code_format CHECK (order_code ~ '^#YACH-[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_code ON public.orders (order_code);

-- ---------------------------------------------------------------------------
-- 9) Helpers de rol (después de crear tablas)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_store_owner(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND s.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_professional_user(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.user_id = p_user_id LIMIT 1
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user_id
      AND COALESCE(p.coverage_km, 0) > 0
  );
$$;

CREATE OR REPLACE FUNCTION public.is_material_request_party(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.material_requests mr
    WHERE mr.id = p_request_id
      AND (mr.professional_id = auth.uid() OR mr.client_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.store_can_see_request(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.material_requests mr
    JOIN public.store_rubros sr ON sr.rubro_id = mr.rubro_id
    JOIN public.stores s ON s.id = sr.store_id
    WHERE mr.id = p_request_id
      AND s.user_id = auth.uid()
      AND s.status IN ('trial', 'active')
      AND mr.status IN ('sent', 'quoted', 'accepted', 'completed')
  );
$$;

-- ---------------------------------------------------------------------------
-- 10) order_code automático (#YACH-XXXX)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_store_order_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
  v_n int;
  v_tries int := 0;
BEGIN
  LOOP
    v_tries := v_tries + 1;
    IF v_tries > 50 THEN
      RAISE EXCEPTION 'No se pudo generar order_code único';
    END IF;

    v_n := floor(random() * 10000)::int;
    v_code := '#YACH-' || lpad(v_n::text, 4, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders o WHERE o.order_code = v_code
    );
  END LOOP;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_orders_set_order_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_code IS NULL OR btrim(NEW.order_code) = '' THEN
    NEW.order_code := public.generate_store_order_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_set_order_code ON public.orders;
CREATE TRIGGER trg_orders_set_order_code
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_orders_set_order_code();

-- ---------------------------------------------------------------------------
-- 11) Triggers de updated_at y estados
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stores_touch ON public.stores;
CREATE TRIGGER trg_stores_touch
BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_material_requests_touch ON public.material_requests;
CREATE TRIGGER trg_material_requests_touch
BEFORE UPDATE ON public.material_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_quotes_touch ON public.quotes;
CREATE TRIGGER trg_quotes_touch
BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_orders_touch ON public.orders;
CREATE TRIGGER trg_orders_touch
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.trg_quotes_on_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    UPDATE public.material_requests
    SET status = 'accepted', updated_at = now()
    WHERE id = NEW.request_id
      AND status IN ('sent', 'quoted');

    UPDATE public.quotes
    SET status = 'rejected', updated_at = now()
    WHERE request_id = NEW.request_id
      AND id <> NEW.id
      AND status = 'sent';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_on_accepted ON public.quotes;
CREATE TRIGGER trg_quotes_on_accepted
AFTER INSERT OR UPDATE OF status ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.trg_quotes_on_accepted();

CREATE OR REPLACE FUNCTION public.trg_quotes_on_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'sent' THEN
    UPDATE public.material_requests
    SET status = 'quoted', updated_at = now()
    WHERE id = NEW.request_id
      AND status = 'sent';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_on_sent ON public.quotes;
CREATE TRIGGER trg_quotes_on_sent
AFTER INSERT ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.trg_quotes_on_sent();

-- ---------------------------------------------------------------------------
-- 12) Seed rubros
-- ---------------------------------------------------------------------------

INSERT INTO public.rubros (name)
VALUES
  ('Pintura'),
  ('Electricidad'),
  ('Corralón'),
  ('Sanitarios'),
  ('Ferretería'),
  ('Gas'),
  ('Aire acondicionado')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.rubros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_rubros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- rubros: lectura para autenticados
DROP POLICY IF EXISTS rubros_select_auth ON public.rubros;
CREATE POLICY rubros_select_auth ON public.rubros
FOR SELECT TO authenticated
USING (true);

-- stores
DROP POLICY IF EXISTS stores_select ON public.stores;
CREATE POLICY stores_select ON public.stores
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR status IN ('trial', 'active')
);

DROP POLICY IF EXISTS stores_insert_own ON public.stores;
CREATE POLICY stores_insert_own ON public.stores
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS stores_update_own ON public.stores;
CREATE POLICY stores_update_own ON public.stores
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS stores_delete_own ON public.stores;
CREATE POLICY stores_delete_own ON public.stores
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- store_rubros
DROP POLICY IF EXISTS store_rubros_select ON public.store_rubros;
CREATE POLICY store_rubros_select ON public.store_rubros
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS store_rubros_insert_owner ON public.store_rubros;
CREATE POLICY store_rubros_insert_owner ON public.store_rubros
FOR INSERT TO authenticated
WITH CHECK (public.is_store_owner(store_id));

DROP POLICY IF EXISTS store_rubros_delete_owner ON public.store_rubros;
CREATE POLICY store_rubros_delete_owner ON public.store_rubros
FOR DELETE TO authenticated
USING (public.is_store_owner(store_id));

-- material_requests
-- Profesional / cliente: sus pedidos. Comercio: pedidos sent+ de su rubro.
DROP POLICY IF EXISTS material_requests_select ON public.material_requests;
CREATE POLICY material_requests_select ON public.material_requests
FOR SELECT TO authenticated
USING (
  professional_id = auth.uid()
  OR client_id = auth.uid()
  OR public.store_can_see_request(id)
);

DROP POLICY IF EXISTS material_requests_insert ON public.material_requests;
CREATE POLICY material_requests_insert ON public.material_requests
FOR INSERT TO authenticated
WITH CHECK (
  (professional_id = auth.uid() OR client_id = auth.uid())
  AND (professional_id IS NOT NULL OR client_id IS NOT NULL)
);

DROP POLICY IF EXISTS material_requests_update ON public.material_requests;
CREATE POLICY material_requests_update ON public.material_requests
FOR UPDATE TO authenticated
USING (professional_id = auth.uid() OR client_id = auth.uid())
WITH CHECK (professional_id = auth.uid() OR client_id = auth.uid());

DROP POLICY IF EXISTS material_requests_delete ON public.material_requests;
CREATE POLICY material_requests_delete ON public.material_requests
FOR DELETE TO authenticated
USING (
  (professional_id = auth.uid() OR client_id = auth.uid())
  AND status = 'draft'
);

-- request_items
DROP POLICY IF EXISTS request_items_select ON public.request_items;
CREATE POLICY request_items_select ON public.request_items
FOR SELECT TO authenticated
USING (
  public.is_material_request_party(request_id)
  OR public.store_can_see_request(request_id)
);

DROP POLICY IF EXISTS request_items_insert ON public.request_items;
CREATE POLICY request_items_insert ON public.request_items
FOR INSERT TO authenticated
WITH CHECK (public.is_material_request_party(request_id));

DROP POLICY IF EXISTS request_items_update ON public.request_items;
CREATE POLICY request_items_update ON public.request_items
FOR UPDATE TO authenticated
USING (public.is_material_request_party(request_id))
WITH CHECK (public.is_material_request_party(request_id));

DROP POLICY IF EXISTS request_items_delete ON public.request_items;
CREATE POLICY request_items_delete ON public.request_items
FOR DELETE TO authenticated
USING (public.is_material_request_party(request_id));

-- quotes
DROP POLICY IF EXISTS quotes_select ON public.quotes;
CREATE POLICY quotes_select ON public.quotes
FOR SELECT TO authenticated
USING (
  public.is_store_owner(store_id)
  OR public.is_material_request_party(request_id)
);

DROP POLICY IF EXISTS quotes_insert_store ON public.quotes;
CREATE POLICY quotes_insert_store ON public.quotes
FOR INSERT TO authenticated
WITH CHECK (
  public.is_store_owner(store_id)
  AND public.store_can_see_request(request_id)
);

DROP POLICY IF EXISTS quotes_update ON public.quotes;
CREATE POLICY quotes_update ON public.quotes
FOR UPDATE TO authenticated
USING (
  public.is_store_owner(store_id)
  OR public.is_material_request_party(request_id)
)
WITH CHECK (
  public.is_store_owner(store_id)
  OR public.is_material_request_party(request_id)
);

-- quote_items
DROP POLICY IF EXISTS quote_items_select ON public.quote_items;
CREATE POLICY quote_items_select ON public.quote_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id
      AND (
        public.is_store_owner(q.store_id)
        OR public.is_material_request_party(q.request_id)
      )
  )
);

DROP POLICY IF EXISTS quote_items_insert ON public.quote_items;
CREATE POLICY quote_items_insert ON public.quote_items
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id AND public.is_store_owner(q.store_id)
  )
);

DROP POLICY IF EXISTS quote_items_update ON public.quote_items;
CREATE POLICY quote_items_update ON public.quote_items
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id AND public.is_store_owner(q.store_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id AND public.is_store_owner(q.store_id)
  )
);

DROP POLICY IF EXISTS quote_items_delete ON public.quote_items;
CREATE POLICY quote_items_delete ON public.quote_items
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id AND public.is_store_owner(q.store_id)
  )
);

-- orders
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id
      AND (
        public.is_store_owner(q.store_id)
        OR public.is_material_request_party(q.request_id)
      )
  )
);

DROP POLICY IF EXISTS orders_insert ON public.orders;
CREATE POLICY orders_insert ON public.orders
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id
      AND q.status = 'accepted'
      AND (
        public.is_store_owner(q.store_id)
        OR public.is_material_request_party(q.request_id)
      )
  )
);

DROP POLICY IF EXISTS orders_update ON public.orders;
CREATE POLICY orders_update ON public.orders
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id
      AND (
        public.is_store_owner(q.store_id)
        OR public.is_material_request_party(q.request_id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_id
      AND (
        public.is_store_owner(q.store_id)
        OR public.is_material_request_party(q.request_id)
      )
  )
);

-- ---------------------------------------------------------------------------
-- 14) Grants
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE public.rubros TO authenticated, service_role;
GRANT ALL ON TABLE public.rubros TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stores TO authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.store_rubros TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.material_requests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.request_items TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quotes TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_items TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.orders TO authenticated, service_role;

GRANT ALL ON TABLE public.stores TO service_role;
GRANT ALL ON TABLE public.store_rubros TO service_role;
GRANT ALL ON TABLE public.material_requests TO service_role;
GRANT ALL ON TABLE public.request_items TO service_role;
GRANT ALL ON TABLE public.quotes TO service_role;
GRANT ALL ON TABLE public.quote_items TO service_role;
GRANT ALL ON TABLE public.orders TO service_role;

GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_professional_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_material_request_party(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_can_see_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_store_order_code() TO authenticated, service_role;

COMMENT ON TABLE public.quotes IS
  'Cotizaciones de comercios sobre material_requests (distinto de contrataciones/chat).';
COMMENT ON TABLE public.orders IS
  'Órdenes al aceptar cotización de comercio; order_code #YACH-XXXX auto.';
COMMENT ON COLUMN public.stores.status IS 'trial | active | unpaid | paused';
COMMENT ON COLUMN public.material_requests.status IS 'draft | sent | quoted | accepted | completed';
