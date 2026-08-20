-- =============================================================================
-- YaChanga — Materiales: geolocalización del cliente, destinos por comercio,
--             quotes → client_id, distancia Haversine
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) material_requests: domicilio del cliente (lat/lng)
-- ---------------------------------------------------------------------------

ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS client_lat double precision,
  ADD COLUMN IF NOT EXISTS client_lng double precision;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'material_requests_client_lat_lng_pair'
      AND conrelid = 'public.material_requests'::regclass
  ) THEN
    ALTER TABLE public.material_requests
      ADD CONSTRAINT material_requests_client_lat_lng_pair CHECK (
        (client_lat IS NULL AND client_lng IS NULL)
        OR (
          client_lat IS NOT NULL AND client_lng IS NOT NULL
          AND client_lat BETWEEN -90 AND 90
          AND client_lng BETWEEN -180 AND 180
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_material_requests_client_geo
  ON public.material_requests (client_lat, client_lng)
  WHERE client_lat IS NOT NULL AND client_lng IS NOT NULL;

COMMENT ON COLUMN public.material_requests.client_lat IS
  'Latitud del domicilio del cliente (para cobertura / flete).';
COMMENT ON COLUMN public.material_requests.client_lng IS
  'Longitud del domicilio del cliente (para cobertura / flete).';

-- ---------------------------------------------------------------------------
-- 2) request_target_stores — comercios a los que el profesional envió el pedido
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.request_target_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.material_requests (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'quoted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_target_stores_request_store_unique UNIQUE (request_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_request_target_stores_request
  ON public.request_target_stores (request_id, status);
CREATE INDEX IF NOT EXISTS idx_request_target_stores_store
  ON public.request_target_stores (store_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_request_target_stores_touch ON public.request_target_stores;
CREATE TRIGGER trg_request_target_stores_touch
BEFORE UPDATE ON public.request_target_stores
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.request_target_stores IS
  'Comercios específicos a los que el profesional envió una lista de materiales.';
COMMENT ON COLUMN public.request_target_stores.status IS
  'pending | quoted | declined';

-- ---------------------------------------------------------------------------
-- 3) quotes: relación directa con client_id (bandeja del cliente)
-- ---------------------------------------------------------------------------

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

-- Backfill desde material_requests
UPDATE public.quotes q
SET client_id = mr.client_id
FROM public.material_requests mr
WHERE q.request_id = mr.id
  AND q.client_id IS NULL
  AND mr.client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_client
  ON public.quotes (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_client_status
  ON public.quotes (client_id, status)
  WHERE client_id IS NOT NULL;

-- Al insertar/actualizar quote, sincronizar client_id desde el pedido
CREATE OR REPLACE FUNCTION public.trg_quotes_set_client_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NULL OR TG_OP = 'INSERT' THEN
    SELECT mr.client_id
      INTO NEW.client_id
    FROM public.material_requests mr
    WHERE mr.id = NEW.request_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_set_client_id ON public.quotes;
CREATE TRIGGER trg_quotes_set_client_id
BEFORE INSERT OR UPDATE OF request_id ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.trg_quotes_set_client_id();

COMMENT ON COLUMN public.quotes.client_id IS
  'Cliente destinatario de la cotización (bandeja directa; se completa desde material_requests).';

-- ---------------------------------------------------------------------------
-- 4) Distancia Haversine (km, 1 decimal)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE ROUND(
      (
        6371.0 * acos(
          LEAST(
            1.0,
            GREATEST(
              -1.0,
              cos(radians(lat1)) * cos(radians(lat2))
                * cos(radians(lng2) - radians(lng1))
              + sin(radians(lat1)) * sin(radians(lat2))
            )
          )
        )
      )::numeric,
      1
    )
  END;
$$;

COMMENT ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) IS
  'Distancia en km (1 decimal) entre dos coordenadas WGS84 (fórmula Haversine).';

REVOKE ALL ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision)
  TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- 5) Visibilidad: comercios solo ven pedidos dirigidos a ellos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_can_see_request(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.request_target_stores rts
    JOIN public.stores s ON s.id = rts.store_id
    JOIN public.material_requests mr ON mr.id = rts.request_id
    WHERE rts.request_id = p_request_id
      AND s.user_id = auth.uid()
      AND s.status IN ('trial', 'active')
      AND mr.status IN ('sent', 'quoted', 'accepted', 'completed')
  );
$$;

-- El comercio solo puede cotizar si está en request_target_stores
CREATE OR REPLACE FUNCTION public.store_is_request_target(p_request_id uuid, p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.request_target_stores rts
    WHERE rts.request_id = p_request_id
      AND rts.store_id = p_store_id
      AND rts.status IN ('pending', 'quoted')
  );
$$;

REVOKE ALL ON FUNCTION public.store_is_request_target(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_is_request_target(uuid, uuid) TO authenticated, service_role;

-- Al enviar cotización, marcar el target como quoted
CREATE OR REPLACE FUNCTION public.trg_quotes_mark_target_quoted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.request_target_stores
  SET status = 'quoted',
      updated_at = now()
  WHERE request_id = NEW.request_id
    AND store_id = NEW.store_id
    AND status = 'pending';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_mark_target_quoted ON public.quotes;
CREATE TRIGGER trg_quotes_mark_target_quoted
AFTER INSERT ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.trg_quotes_mark_target_quoted();

-- ---------------------------------------------------------------------------
-- 6) RLS — request_target_stores + quotes client_id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

ALTER TABLE public.request_target_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS request_target_stores_select ON public.request_target_stores;
CREATE POLICY request_target_stores_select ON public.request_target_stores
FOR SELECT TO authenticated
USING (
  public.is_material_request_party(request_id)
  OR public.is_store_owner(store_id)
  OR public.is_admin()
);

DROP POLICY IF EXISTS request_target_stores_insert ON public.request_target_stores;
CREATE POLICY request_target_stores_insert ON public.request_target_stores
FOR INSERT TO authenticated
WITH CHECK (
  public.is_material_request_party(request_id)
  OR public.is_admin()
);

DROP POLICY IF EXISTS request_target_stores_update ON public.request_target_stores;
CREATE POLICY request_target_stores_update ON public.request_target_stores
FOR UPDATE TO authenticated
USING (
  public.is_material_request_party(request_id)
  OR public.is_store_owner(store_id)
  OR public.is_admin()
)
WITH CHECK (
  public.is_material_request_party(request_id)
  OR public.is_store_owner(store_id)
  OR public.is_admin()
);

DROP POLICY IF EXISTS request_target_stores_delete ON public.request_target_stores;
CREATE POLICY request_target_stores_delete ON public.request_target_stores
FOR DELETE TO authenticated
USING (
  public.is_material_request_party(request_id)
  OR public.is_admin()
);

-- quotes: bandeja directa del cliente + destinos
DROP POLICY IF EXISTS quotes_select ON public.quotes;
CREATE POLICY quotes_select ON public.quotes
FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR public.is_store_owner(store_id)
  OR public.is_material_request_party(request_id)
  OR public.is_admin()
);

DROP POLICY IF EXISTS quotes_insert_store ON public.quotes;
CREATE POLICY quotes_insert_store ON public.quotes
FOR INSERT TO authenticated
WITH CHECK (
  public.is_store_owner(store_id)
  AND public.store_is_request_target(request_id, store_id)
  AND public.store_can_see_request(request_id)
);

DROP POLICY IF EXISTS quotes_update ON public.quotes;
CREATE POLICY quotes_update ON public.quotes
FOR UPDATE TO authenticated
USING (
  client_id = auth.uid()
  OR public.is_store_owner(store_id)
  OR public.is_material_request_party(request_id)
  OR public.is_admin()
)
WITH CHECK (
  client_id = auth.uid()
  OR public.is_store_owner(store_id)
  OR public.is_material_request_party(request_id)
  OR public.is_admin()
);

-- ---------------------------------------------------------------------------
-- 7) Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.request_target_stores
  TO authenticated, service_role;
GRANT ALL ON TABLE public.request_target_stores TO service_role;

GRANT EXECUTE ON FUNCTION public.trg_quotes_set_client_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_quotes_mark_target_quoted() TO service_role;
