-- #114 Suscripción mensual de comercios.
-- NO está aplicado. NO despliega edges. La app lee las RPC; el admin no va en este PR.
--
-- Producción kyxehrxcdealbujvvnxp, pg_get_functiondef el 2026-10-26:
--   stores_protect_admin_fields()                         md5 9a2b6f550fd4253ff5d787ca14ed08c2
--   admin_approve_store(uuid)                             md5 918232cd885bde6d70924a6cd161617c
--   store_is_eligible_for_quotes(uuid)                    md5 19c23f633e47bcb3bac3934fb9fdd3eb
--   _admin_store_json(uuid)                               md5 fa50e6b2ffb98803acf38ac59e3fb904
--   admin_list_stores_with_email()                        md5 96b8b014fb2eb828aea9f1802766078e
--
-- Decisión: no hay columna subscription_status. El estado sigue siendo stores.status
-- (la app y el admin ya lo leen). Mapa:
--   pending_approval = en revisión
--   trial            = prueba (trialing)
--   active           = suscripción cobrada
--   unpaid           = past_due / suspendido (oculto para pedidos nuevos)
--   paused           = pausa de admin
--   rejected         = rechazado
-- current_period_end NULL en un active legado sigue siendo elegible.
-- Los dos comercios trial de hoy siguen hasta su trial_ends_at actual.
--
-- store_can_see_request y store_is_request_target ya llaman a
-- store_is_eligible_for_quotes: no se recrean.
-- admin_extend_store_trial y admin_activate_store_trial no se tocan
-- (esta última sigue sumando 30 días fijos).
--
-- Mercado Pago solo sandbox. El comercio no recibe el PIN ni los ids de MP.
-- anon no tiene EXECUTE de nada nuevo ni de lo recreado.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

BEGIN;

-- ---------------------------------------------------------------------------
-- Configuración (una fila) y precios A/B/C. C queda NULL = «COMPLETAR».
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.store_subscription_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  trial_days integer NOT NULL DEFAULT 60 CHECK (trial_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id)
);

INSERT INTO public.store_subscription_settings (id, trial_days)
VALUES (true, 60)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.store_categories (
  code text PRIMARY KEY CHECK (code IN ('A', 'B', 'C')),
  monthly_fee numeric CHECK (monthly_fee IS NULL OR monthly_fee > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id)
);

INSERT INTO public.store_categories (code, monthly_fee) VALUES
  ('A', 40000),
  ('B', 60000),
  ('C', NULL)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.store_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('payment', 'preapproval')),
  mp_id text NOT NULL CHECK (length(btrim(mp_id)) > 0),
  mp_status text NOT NULL CHECK (length(btrim(mp_status)) > 0),
  store_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, mp_id, mp_status)
);

ALTER TABLE public.store_subscription_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_subscription_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.store_subscription_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.store_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.store_subscription_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.store_subscription_settings TO service_role;
GRANT ALL ON TABLE public.store_categories TO service_role;
GRANT ALL ON TABLE public.store_subscription_events TO service_role;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS mp_preapproval_id text,
  ADD COLUMN IF NOT EXISTS mp_payer_id text,
  ADD COLUMN IF NOT EXISTS trial_notice_20_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_notice_10_sent_at timestamptz;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_category_fkey'
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_category_fkey
      FOREIGN KEY (category) REFERENCES public.store_categories (code);
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS stores_mp_preapproval_id_idx
  ON public.stores (mp_preapproval_id)
  WHERE mp_preapproval_id IS NOT NULL;

-- El comercio no lee categoría, precio ni identificadores de MP por la tabla.
-- Los ve solo por get_my_store_subscription (sin ids de MP y sin PIN).
REVOKE SELECT (
  category,
  current_period_end,
  mp_preapproval_id,
  mp_payer_id,
  trial_notice_20_sent_at,
  trial_notice_10_sent_at
) ON public.stores FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.stores.category IS
  '#114. A, B o C. La asigna el admin. NULL = sin categoría.';
COMMENT ON COLUMN public.stores.current_period_end IS
  '#114. Fin del período pago. NULL en un active legado no corta la elegibilidad.';
COMMENT ON COLUMN public.stores.mp_preapproval_id IS
  '#114. Id de la preapproval de MP sandbox. El comercio no lo lee.';
COMMENT ON COLUMN public.stores.mp_payer_id IS
  '#114. Id del pagador en MP. El comercio no lo lee. No es un dato de tarjeta.';
COMMENT ON TABLE public.store_categories IS
  '#114. monthly_fee NULL = precio sin cargar (COMPLETAR en el admin).';

-- ---------------------------------------------------------------------------
-- Textos de push. Misma redacción que la app (src/utils/storeSubscription.ts).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_subscription_notice_body(p_kind text, p_days integer)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_kind = 'approved' THEN
      format(
        '¡Tu comercio fue aprobado! Ya podés usar YaChanga gratis por %s %s.',
        p_days,
        CASE WHEN p_days = 1 THEN 'día' ELSE 'días' END
      )
    WHEN p_kind = 'trial_20' THEN
      format(
        'Te quedan %s días de prueba gratis. Vinculá tu medio de pago hoy para no perder ventas cuando termine el período.',
        p_days
      )
    WHEN p_kind = 'trial_10' AND coalesce(p_days, 0) <= 0 THEN
      '¡Atención! Tu prueba gratis termina hoy. Configurá tu débito automático para evitar la suspensión de tu comercio.'
    WHEN p_kind = 'trial_10' AND p_days = 1 THEN
      '¡Atención! Te queda solo 1 día de prueba gratis. Configurá tu débito automático para evitar la suspensión de tu comercio.'
    WHEN p_kind = 'trial_10' THEN
      format(
        '¡Atención! Te quedan solo %s días de prueba gratis. Configurá tu débito automático para evitar la suspensión de tu comercio.',
        p_days
      )
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION public.store_subscription_notice_body(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_subscription_notice_body(text, integer) TO service_role;

-- <fn store_subscription_settings_json>
CREATE OR REPLACE FUNCTION public.store_subscription_settings_json()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'trial_days', s.trial_days,
    'updated_at', s.updated_at,
    'updated_by', s.updated_by,
    'categories', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'code', c.code,
          'monthly_fee', c.monthly_fee,
          'updated_at', c.updated_at,
          'updated_by', c.updated_by
        )
        ORDER BY c.code
      )
      FROM public.store_categories c
    ), '[]'::jsonb)
  )
  FROM public.store_subscription_settings s
  WHERE s.id;
$function$;
-- </fn store_subscription_settings_json>

REVOKE ALL ON FUNCTION public.store_subscription_settings_json() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_subscription_settings_json() TO service_role;

-- ---------------------------------------------------------------------------
-- Trigger. Cuerpo vivo md5 9a2b6f550fd4253ff5d787ca14ed08c2.
-- Único cambio: las columnas nuevas quedan congeladas para quien no es admin.
-- ---------------------------------------------------------------------------

DO $guard_protect$
BEGIN
  IF md5(pg_get_functiondef('public.stores_protect_admin_fields()'::regprocedure))
     IS DISTINCT FROM '9a2b6f550fd4253ff5d787ca14ed08c2' THEN
    RAISE EXCEPTION 'stores_protect_admin_fields cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #114.';
  END IF;
END
$guard_protect$;

CREATE OR REPLACE FUNCTION public.stores_protect_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending_approval';
    NEW.trial_ends_at := NULL;
    NEW.approved_at := NULL;
    NEW.approved_by := NULL;
    NEW.rejection_reason := '';
    NEW.category := NULL;
    NEW.current_period_end := NULL;
    NEW.mp_preapproval_id := NULL;
    NEW.mp_payer_id := NULL;
    NEW.trial_notice_20_sent_at := NULL;
    NEW.trial_notice_10_sent_at := NULL;
  ELSE
    NEW.user_id := OLD.user_id;
    NEW.status := OLD.status;
    NEW.trial_ends_at := OLD.trial_ends_at;
    NEW.approved_at := OLD.approved_at;
    NEW.approved_by := OLD.approved_by;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.category := OLD.category;
    NEW.current_period_end := OLD.current_period_end;
    NEW.mp_preapproval_id := OLD.mp_preapproval_id;
    NEW.mp_payer_id := OLD.mp_payer_id;
    NEW.trial_notice_20_sent_at := OLD.trial_notice_20_sent_at;
    NEW.trial_notice_10_sent_at := OLD.trial_notice_10_sent_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.stores_protect_admin_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stores_protect_admin_fields() TO service_role;

-- ---------------------------------------------------------------------------
-- Elegibilidad. Cuerpo vivo md5 19c23f633e47bcb3bac3934fb9fdd3eb.
-- Sigue: active (período vigente o NULL legado) o trial con trial_ends_at
-- >= hoy en Argentina. unpaid (past_due/suspendido) no entra.
-- ---------------------------------------------------------------------------

DO $guard_eligible$
BEGIN
  IF md5(pg_get_functiondef('public.store_is_eligible_for_quotes(uuid)'::regprocedure))
     IS DISTINCT FROM '19c23f633e47bcb3bac3934fb9fdd3eb' THEN
    RAISE EXCEPTION 'store_is_eligible_for_quotes cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #114.';
  END IF;
END
$guard_eligible$;

-- <fn store_is_eligible_for_quotes>
CREATE OR REPLACE FUNCTION public.store_is_eligible_for_quotes(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.stores s
    WHERE s.id = p_store_id
      AND (
        (
          s.status = 'active'
          AND (
            s.current_period_end IS NULL
            OR (s.current_period_end AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
              >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
          )
        )
        OR (
          s.status = 'trial'
          AND (
            s.trial_ends_at IS NULL
            OR (s.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
              >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
          )
        )
      )
  );
$function$;
-- </fn store_is_eligible_for_quotes>

REVOKE ALL ON FUNCTION public.store_is_eligible_for_quotes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_is_eligible_for_quotes(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- JSON de admin. Cuerpo vivo md5 fa50e6b2ffb98803acf38ac59e3fb904.
-- Se agregan categoría, precio, fin de período, débito sí/no y días restantes.
-- No se devuelven mp_preapproval_id, mp_payer_id ni PIN.
-- ---------------------------------------------------------------------------

DO $guard_json$
BEGIN
  IF md5(pg_get_functiondef('public._admin_store_json(uuid)'::regprocedure))
     IS DISTINCT FROM 'fa50e6b2ffb98803acf38ac59e3fb904' THEN
    RAISE EXCEPTION '_admin_store_json cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #114.';
  END IF;
END
$guard_json$;

CREATE OR REPLACE FUNCTION public._admin_store_json(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_store public.stores%ROWTYPE;
  v_email text := '';
  v_rubros jsonb := '[]'::jsonb;
  v_fee numeric;
  v_trial_days integer;
BEGIN
  PERFORM public._admin_require();

  SELECT * INTO v_store
  FROM public.stores
  WHERE id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comercio no encontrado';
  END IF;

  SELECT coalesce(u.email, '')
  INTO v_email
  FROM auth.users u
  WHERE u.id = v_store.user_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'created_at', r.created_at
      )
      ORDER BY r.name
    ),
    '[]'::jsonb
  )
  INTO v_rubros
  FROM public.store_rubros sr
  JOIN public.rubros r ON r.id = sr.rubro_id
  WHERE sr.store_id = v_store.id;

  SELECT c.monthly_fee INTO v_fee
  FROM public.store_categories c
  WHERE c.code = v_store.category;

  SELECT s.trial_days INTO v_trial_days
  FROM public.store_subscription_settings s
  WHERE s.id;

  RETURN jsonb_build_object(
    'id', v_store.id,
    'user_id', v_store.user_id,
    'name', v_store.name,
    'email', coalesce(v_email, ''),
    'phone', v_store.phone,
    'address', v_store.address,
    'latitude', v_store.latitude,
    'longitude', v_store.longitude,
    'coverage_radius_km', v_store.coverage_radius_km,
    'status', v_store.status,
    'trial_ends_at', v_store.trial_ends_at,
    'approved_at', v_store.approved_at,
    'approved_by', v_store.approved_by,
    'rejection_reason', v_store.rejection_reason,
    'created_at', v_store.created_at,
    'updated_at', v_store.updated_at,
    'rubros', v_rubros,
    'category', v_store.category,
    'monthly_fee', v_fee,
    'current_period_end', v_store.current_period_end,
    'debit_linked', nullif(btrim(coalesce(v_store.mp_preapproval_id, '')), '') IS NOT NULL,
    'trial_days', v_trial_days,
    'trial_days_remaining', CASE
      WHEN v_store.trial_ends_at IS NULL THEN NULL
      ELSE (
        (v_store.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        - (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      )
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._admin_store_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_store_json(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Listado con mail. Cuerpo vivo md5 96b8b014fb2eb828aea9f1802766078e.
-- Mismas claves nuevas que _admin_store_json. Sin ids de MP.
-- ---------------------------------------------------------------------------

DO $guard_list_email$
BEGIN
  IF md5(pg_get_functiondef('public.admin_list_stores_with_email()'::regprocedure))
     IS DISTINCT FROM '96b8b014fb2eb828aea9f1802766078e' THEN
    RAISE EXCEPTION 'admin_list_stores_with_email cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #114.';
  END IF;
END
$guard_list_email$;

CREATE OR REPLACE FUNCTION public.admin_list_stores_with_email()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'name', s.name,
      'email', u.email,
      'phone', s.phone,
      'address', s.address,
      'latitude', s.latitude,
      'longitude', s.longitude,
      'coverage_radius_km', s.coverage_radius_km,
      'status', s.status,
      'trial_ends_at', s.trial_ends_at,
      'approved_at', s.approved_at,
      'rejection_reason', s.rejection_reason,
      'created_at', s.created_at,
      'rubros', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)), '[]'::jsonb)
        FROM public.store_rubros sr
        JOIN public.rubros r ON r.id = sr.rubro_id
        WHERE sr.store_id = s.id
      ),
      'category', s.category,
      'monthly_fee', (
        SELECT c.monthly_fee FROM public.store_categories c WHERE c.code = s.category
      ),
      'current_period_end', s.current_period_end,
      'debit_linked', nullif(btrim(coalesce(s.mp_preapproval_id, '')), '') IS NOT NULL,
      'trial_days', (
        SELECT settings.trial_days FROM public.store_subscription_settings settings WHERE settings.id
      ),
      'trial_days_remaining', CASE
        WHEN s.trial_ends_at IS NULL THEN NULL
        ELSE (
          (s.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
          - (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        )
      END
    ) ORDER BY s.created_at DESC)
    FROM public.stores s
    JOIN auth.users u ON u.id = s.user_id
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_stores_with_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_stores_with_email() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Aprobar. Cuerpo vivo md5 918232cd885bde6d70924a6cd161617c.
-- trial_ends_at = ahora + trial_days (default 60), solo si todavía es NULL.
-- No pisa comercios que ya tenían fecha. Push de aprobación una sola vez.
-- ---------------------------------------------------------------------------

DO $guard_approve$
BEGIN
  IF md5(pg_get_functiondef('public.admin_approve_store(uuid)'::regprocedure))
     IS DISTINCT FROM '918232cd885bde6d70924a6cd161617c' THEN
    RAISE EXCEPTION 'admin_approve_store cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #114.';
  END IF;
END
$guard_approve$;

CREATE OR REPLACE FUNCTION public.admin_approve_store(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_store public.stores%ROWTYPE;
  v_days integer;
  v_updated boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede aprobar comercios';
  END IF;

  SELECT settings.trial_days INTO v_days
  FROM public.store_subscription_settings settings
  WHERE settings.id;

  v_days := greatest(1, least(coalesce(v_days, 60), 365));

  UPDATE public.stores
  SET
    status = 'trial',
    trial_ends_at = COALESCE(trial_ends_at, now() + (v_days || ' days')::interval),
    approved_at = now(),
    approved_by = auth.uid(),
    rejection_reason = '',
    updated_at = now()
  WHERE id = p_store_id
    AND status IN ('pending_approval', 'rejected')
  RETURNING * INTO v_store;

  IF FOUND THEN
    v_updated := true;
  ELSE
    SELECT * INTO v_store FROM public.stores WHERE id = p_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Comercio no encontrado';
    END IF;
    IF v_store.status NOT IN ('trial', 'active') THEN
      RAISE EXCEPTION 'El comercio no está pendiente de aprobación (status=%)', v_store.status;
    END IF;
  END IF;

  IF v_updated THEN
    PERFORM public.enqueue_store_push(
      v_store.id,
      'store_approved',
      'Comercio aprobado',
      public.store_subscription_notice_body('approved', v_days),
      jsonb_build_object(
        'kind', 'store_approved',
        'store_id', v_store.id,
        'trial_days', v_days
      )
    );
  END IF;

  RETURN public._admin_store_json(v_store.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_approve_store(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_store(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC de admin. authenticated + is_admin() adentro. Nada para anon.
-- monthly_fee NULL = COMPLETAR.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_subscription_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._admin_require();
  RETURN public.store_subscription_settings_json();
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_subscription_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_subscription_settings() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_subscription_settings() IS
  '#114. { trial_days, updated_at, updated_by, categories: [{ code, monthly_fee, updated_at, updated_by }] }. monthly_fee null = COMPLETAR.';

CREATE OR REPLACE FUNCTION public.admin_set_trial_days(p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
BEGIN
  v_admin := public._admin_require();

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Los días de prueba tienen que ser un número entre 1 y 365.';
  END IF;

  UPDATE public.store_subscription_settings
  SET trial_days = p_days,
      updated_at = now(),
      updated_by = v_admin
  WHERE id;

  RETURN public.store_subscription_settings_json();
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_trial_days(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_trial_days(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_trial_days(integer) IS
  '#114. Cambia los días de prueba (1..365). No mueve trial_ends_at de comercios ya aprobados.';

CREATE OR REPLACE FUNCTION public.admin_set_store_category_fee(p_code text, p_fee numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
BEGIN
  v_admin := public._admin_require();

  IF v_code NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'La categoría tiene que ser A, B o C.';
  END IF;

  IF p_fee IS NOT NULL AND p_fee <= 0 THEN
    RAISE EXCEPTION 'El costo mensual tiene que ser mayor a 0, o vacío si todavía no está cargado.';
  END IF;

  UPDATE public.store_categories
  SET monthly_fee = p_fee,
      updated_at = now(),
      updated_by = v_admin
  WHERE code = v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoría no encontrada';
  END IF;

  RETURN public.store_subscription_settings_json();
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_store_category_fee(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_store_category_fee(text, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_store_category_fee(text, numeric) IS
  '#114. Precio mensual de A, B o C. p_fee NULL deja el precio sin cargar (COMPLETAR).';

CREATE OR REPLACE FUNCTION public.admin_set_store_category(p_store_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
BEGIN
  PERFORM public._admin_require();

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'storeId es obligatorio.';
  END IF;

  IF v_code IS NOT NULL AND v_code NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'La categoría tiene que ser A, B, C o vacía.';
  END IF;

  UPDATE public.stores
  SET category = v_code,
      updated_at = now()
  WHERE id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comercio no encontrado';
  END IF;

  RETURN public._admin_store_json(p_store_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_store_category(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_store_category(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_store_category(uuid, text) IS
  '#114. Asigna A, B o C a un comercio. p_code NULL o vacío saca la categoría. El comercio no elige.';

-- ---------------------------------------------------------------------------
-- El comercio ve solo el suyo: estado, días, categoría y precio. Sin PIN ni MP.
-- ---------------------------------------------------------------------------

-- <fn get_my_store_subscription>
CREATE OR REPLACE FUNCTION public.get_my_store_subscription()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_store public.stores%ROWTYPE;
  v_trial_days integer;
  v_fee numeric;
  v_days integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT settings.trial_days INTO v_trial_days
  FROM public.store_subscription_settings settings
  WHERE settings.id;

  v_trial_days := greatest(1, least(coalesce(v_trial_days, 60), 365));

  SELECT * INTO v_store
  FROM public.stores s
  WHERE s.user_id = v_uid
  ORDER BY s.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'trial_days', v_trial_days,
      'store_id', NULL,
      'status', NULL,
      'trial_ends_at', NULL,
      'days_remaining', NULL,
      'category', NULL,
      'monthly_fee', NULL,
      'current_period_end', NULL,
      'debit_linked', false
    );
  END IF;

  SELECT c.monthly_fee INTO v_fee
  FROM public.store_categories c
  WHERE c.code = v_store.category;

  IF v_store.trial_ends_at IS NULL THEN
    v_days := NULL;
  ELSE
    v_days := (
      (v_store.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      - (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    );
  END IF;

  RETURN jsonb_build_object(
    'trial_days', v_trial_days,
    'store_id', v_store.id,
    'status', v_store.status,
    'trial_ends_at', v_store.trial_ends_at,
    'days_remaining', v_days,
    'category', v_store.category,
    'monthly_fee', v_fee,
    'current_period_end', v_store.current_period_end,
    'debit_linked', nullif(btrim(coalesce(v_store.mp_preapproval_id, '')), '') IS NOT NULL
  );
END;
$function$;
-- </fn get_my_store_subscription>

REVOKE ALL ON FUNCTION public.get_my_store_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_store_subscription() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_store_subscription() IS
  '#114. Suscripción del comercio logueado. Sin datos de otros, sin PIN y sin ids de Mercado Pago.';

-- ---------------------------------------------------------------------------
-- Webhook de suscripción (lo llama la edge con service_role). Idempotente.
-- approved → active y current_period_end = ahora + 30 días.
-- rejected y afines → unpaid, salvo que la prueba siga vigente.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_store_subscription_mp_event(
  p_source text,
  p_mp_id text,
  p_status text,
  p_store_id uuid,
  p_preapproval_id text,
  p_payer_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_mp_id text := btrim(coalesce(p_mp_id, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_store public.stores%ROWTYPE;
  v_preapproval text := nullif(btrim(coalesce(p_preapproval_id, '')), '');
  v_payer text := nullif(btrim(coalesce(p_payer_id, '')), '');
  v_event_id uuid;
  v_today date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_trial_open boolean;
BEGIN
  IF v_source NOT IN ('payment', 'preapproval') THEN
    RAISE EXCEPTION 'source inválido';
  END IF;
  IF v_mp_id = '' OR v_status = '' THEN
    RAISE EXCEPTION 'mp_id y status son obligatorios';
  END IF;

  SELECT * INTO v_store
  FROM public.stores s
  WHERE (p_store_id IS NOT NULL AND s.id = p_store_id)
     OR (v_preapproval IS NOT NULL AND s.mp_preapproval_id = v_preapproval)
  ORDER BY CASE WHEN p_store_id IS NOT NULL AND s.id = p_store_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'store_not_found');
  END IF;

  INSERT INTO public.store_subscription_events (source, mp_id, mp_status, store_id)
  VALUES (v_source, v_mp_id, v_status, v_store.id)
  ON CONFLICT (source, mp_id, mp_status) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'store_id', v_store.id);
  END IF;

  v_trial_open := v_store.status = 'trial'
    AND (
      v_store.trial_ends_at IS NULL
      OR (v_store.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= v_today
    );

  IF v_source = 'payment' AND v_status = 'approved' THEN
    UPDATE public.stores
    SET
      status = 'active',
      current_period_end = now() + interval '30 days',
      mp_preapproval_id = coalesce(v_preapproval, mp_preapproval_id),
      mp_payer_id = coalesce(v_payer, mp_payer_id),
      updated_at = now()
    WHERE id = v_store.id;
    RETURN jsonb_build_object('ok', true, 'status', 'active', 'store_id', v_store.id);
  END IF;

  IF v_source = 'payment' AND v_status IN ('rejected', 'cancelled', 'charged_back', 'refunded') THEN
    IF NOT v_trial_open THEN
      UPDATE public.stores
      SET
        status = 'unpaid',
        mp_preapproval_id = coalesce(v_preapproval, mp_preapproval_id),
        mp_payer_id = coalesce(v_payer, mp_payer_id),
        updated_at = now()
      WHERE id = v_store.id;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'status', CASE WHEN v_trial_open THEN v_store.status ELSE 'unpaid' END,
      'store_id', v_store.id
    );
  END IF;

  IF v_source = 'preapproval' AND v_status = 'authorized' THEN
    UPDATE public.stores
    SET
      mp_preapproval_id = coalesce(v_preapproval, v_mp_id),
      mp_payer_id = coalesce(v_payer, mp_payer_id),
      updated_at = now()
    WHERE id = v_store.id;
    RETURN jsonb_build_object(
      'ok', true,
      'debit_linked', true,
      'status', v_store.status,
      'store_id', v_store.id
    );
  END IF;

  IF v_source = 'preapproval' AND v_status IN ('cancelled', 'paused') THEN
    UPDATE public.stores
    SET
      mp_preapproval_id = NULL,
      updated_at = now(),
      status = CASE
        WHEN v_trial_open THEN status
        WHEN status IN ('active', 'trial') THEN 'unpaid'
        ELSE status
      END
    WHERE id = v_store.id;
    RETURN jsonb_build_object('ok', true, 'debit_linked', false, 'store_id', v_store.id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'skipped', 'status_ignored', 'store_id', v_store.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_store_subscription_mp_event(text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_store_subscription_mp_event(text, text, text, uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Cron diario 09:00 Argentina (12:00 UTC, ART sin horario de verano).
-- Avisos cuando quedan <= 20 y <= 10 días (no el día 40/50 fijo).
-- Al vencer la prueba o el período pago, status pasa a unpaid.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_store_subscription_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_notice record;
  v_n20 integer := 0;
  v_n10 integer := 0;
  v_trial_ended integer := 0;
  v_period_ended integer := 0;
BEGIN
  FOR v_notice IN
    UPDATE public.stores s
    SET
      trial_notice_10_sent_at = now(),
      trial_notice_20_sent_at = coalesce(s.trial_notice_20_sent_at, now()),
      updated_at = now()
    WHERE s.status = 'trial'
      AND s.trial_notice_10_sent_at IS NULL
      AND nullif(btrim(coalesce(s.mp_preapproval_id, '')), '') IS NULL
      AND s.trial_ends_at IS NOT NULL
      AND (
        (s.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        - (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      ) BETWEEN 0 AND 10
    RETURNING
      s.id AS store_id,
      (
        (s.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        - (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      ) AS days_left
  LOOP
    PERFORM public.enqueue_store_push(
      v_notice.store_id,
      'store_trial_notice_10',
      'Tu prueba está por terminar',
      public.store_subscription_notice_body('trial_10', v_notice.days_left),
      jsonb_build_object(
        'kind', 'store_trial_notice_10',
        'store_id', v_notice.store_id,
        'days_left', v_notice.days_left
      )
    );
    v_n10 := v_n10 + 1;
  END LOOP;

  FOR v_notice IN
    UPDATE public.stores s
    SET
      trial_notice_20_sent_at = now(),
      updated_at = now()
    WHERE s.status = 'trial'
      AND s.trial_notice_20_sent_at IS NULL
      AND nullif(btrim(coalesce(s.mp_preapproval_id, '')), '') IS NULL
      AND s.trial_ends_at IS NOT NULL
      AND (
        (s.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        - (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      ) BETWEEN 11 AND 20
    RETURNING
      s.id AS store_id,
      (
        (s.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        - (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      ) AS days_left
  LOOP
    PERFORM public.enqueue_store_push(
      v_notice.store_id,
      'store_trial_notice_20',
      'Prueba gratis',
      public.store_subscription_notice_body('trial_20', v_notice.days_left),
      jsonb_build_object(
        'kind', 'store_trial_notice_20',
        'store_id', v_notice.store_id,
        'days_left', v_notice.days_left
      )
    );
    v_n20 := v_n20 + 1;
  END LOOP;

  UPDATE public.stores s
  SET status = 'unpaid',
      updated_at = now()
  WHERE s.status = 'trial'
    AND s.trial_ends_at IS NOT NULL
    AND (s.trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  GET DIAGNOSTICS v_trial_ended = ROW_COUNT;

  UPDATE public.stores s
  SET status = 'unpaid',
      updated_at = now()
  WHERE s.status = 'active'
    AND s.current_period_end IS NOT NULL
    AND (s.current_period_end AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  GET DIAGNOSTICS v_period_ended = ROW_COUNT;

  RETURN jsonb_build_object(
    'notices_20', v_n20,
    'notices_10', v_n10,
    'trials_suspended', v_trial_ended,
    'periods_suspended', v_period_ended
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_store_subscription_daily() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_store_subscription_daily() TO service_role;

SELECT cron.schedule(
  'store_subscription_daily',
  '0 12 * * *',
  $cron$SELECT public.run_store_subscription_daily();$cron$
);

COMMIT;
