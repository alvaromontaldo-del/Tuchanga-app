-- =============================================================================
-- YaChanga — Comercios: estado pending_approval + aprobación admin
-- Hasta que un admin apruebe, el comercio NO recibe solicitudes de cotización.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Ampliar status de stores
-- ---------------------------------------------------------------------------

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_status_check;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_status_check CHECK (
    status IN (
      'pending_approval',
      'trial',
      'active',
      'unpaid',
      'paused',
      'rejected'
    )
  );

-- Altas futuras (app): pendientes de aprobación por defecto.
ALTER TABLE public.stores
  ALTER COLUMN status SET DEFAULT 'pending_approval';

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.stores.status IS
  'pending_approval | trial | active | unpaid | paused | rejected';
COMMENT ON COLUMN public.stores.approved_at IS
  'Momento en que un admin aprobó el alta (pasa a trial).';

CREATE INDEX IF NOT EXISTS idx_stores_pending_approval
  ON public.stores (created_at DESC)
  WHERE status = 'pending_approval';

-- ---------------------------------------------------------------------------
-- 2) Elegibilidad para recibir cotizaciones (solo trial / active)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_is_eligible_for_quotes(p_store_id uuid)
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
      AND s.status IN ('trial', 'active')
  );
$$;

REVOKE ALL ON FUNCTION public.store_is_eligible_for_quotes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_is_eligible_for_quotes(uuid)
  TO authenticated, service_role;

-- Visibilidad de pedidos: el dueño solo si el comercio está aprobado (trial/active).
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
      AND public.store_is_eligible_for_quotes(s.id)
      AND mr.status IN ('sent', 'quoted', 'accepted', 'completed')
  );
$$;

-- Cotizar solo si es target Y el comercio está aprobado.
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
  )
  AND public.store_is_eligible_for_quotes(p_store_id);
$$;

-- Lectura pública de comercios: solo aprobados (trial/active). Dueño ve el suyo siempre.
DROP POLICY IF EXISTS stores_select ON public.stores;
CREATE POLICY stores_select ON public.stores
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin()
  OR status IN ('trial', 'active')
);

-- ---------------------------------------------------------------------------
-- 3) Aprobar / rechazar (solo admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_approve_store(p_store_id uuid)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.stores%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede aprobar comercios';
  END IF;

  UPDATE public.stores
  SET
    status = 'trial',
    trial_ends_at = COALESCE(trial_ends_at, now() + interval '30 days'),
    approved_at = now(),
    approved_by = auth.uid(),
    rejection_reason = '',
    updated_at = now()
  WHERE id = p_store_id
    AND status IN ('pending_approval', 'rejected')
  RETURNING * INTO v_store;

  IF NOT FOUND THEN
    -- Idempotente: si ya está trial/active, devolver fila.
    SELECT * INTO v_store FROM public.stores WHERE id = p_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Comercio no encontrado';
    END IF;
    IF v_store.status NOT IN ('trial', 'active') THEN
      RAISE EXCEPTION 'El comercio no está pendiente de aprobación (status=%)', v_store.status;
    END IF;
  END IF;

  RETURN v_store;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_store(
  p_store_id uuid,
  p_reason text DEFAULT ''
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.stores%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede rechazar comercios';
  END IF;

  UPDATE public.stores
  SET
    status = 'rejected',
    rejection_reason = COALESCE(btrim(p_reason), ''),
    updated_at = now()
  WHERE id = p_store_id
    AND status = 'pending_approval'
  RETURNING * INTO v_store;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comercio no encontrado o no está pendiente de aprobación';
  END IF;

  RETURN v_store;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_store(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_store(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_approve_store(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_store(uuid, text) TO authenticated, service_role;
