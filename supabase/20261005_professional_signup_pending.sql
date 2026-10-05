-- Alta profesional: después de validar el mail el estado es pending.
-- admin_list_users reescribía el estado: con oficios o cobertura devolvía
-- 'accepted' y si no, 'none'. Un pending con oficios figuraba Aprobado y el
-- modal no mostraba Aprobar / Rechazar.
-- Este archivo instala el listado completo. No depende del texto que haya
-- en la base. Aprobar y rechazar siguen siendo del admin.
-- UserDetailModal no está en esta app: lee professional_status de
-- admin_list_users y admin_get_user_detail. Con pending muestra Aprobar y
-- Rechazar. deactivated_at gana y se informa como deactivated.

CREATE OR REPLACE FUNCTION public.admin_approve_professional(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_has_jobs boolean;
BEGIN
  PERFORM public._admin_require();

  SELECT p.professional_status,
         (
           EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
           OR coalesce(p.coverage_km, 0) > 0
         )
  INTO v_status, v_has_jobs
  FROM public.profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF NOT coalesce(v_has_jobs, false) THEN
    RAISE EXCEPTION 'Este usuario no tiene perfil profesional para aprobar.';
  END IF;

  IF v_status = 'accepted' THEN
    RETURN public.admin_get_user_detail(p_user_id);
  END IF;

  IF coalesce(v_status, 'none') NOT IN ('pending', 'rejected', 'paused', 'none') THEN
    RAISE EXCEPTION 'No se puede aprobar un profesional en estado %.', v_status;
  END IF;

  UPDATE public.profiles
  SET
    professional_status = 'accepted',
    professional_reviewed_at = now(),
    professional_reviewed_by = auth.uid(),
    professional_rejection_reason = NULL,
    professional_deactivated_at = NULL,
    professional_deactivated_by = NULL,
    updated_at = now()
  WHERE id = p_user_id;

  RETURN public.admin_get_user_detail(p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reject_professional(p_user_id uuid, p_reason text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_has_jobs boolean;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  PERFORM public._admin_require();

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Tenés que indicar el motivo del rechazo.';
  END IF;

  SELECT p.professional_status,
         (
           EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
           OR coalesce(p.coverage_km, 0) > 0
         )
  INTO v_status, v_has_jobs
  FROM public.profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF NOT coalesce(v_has_jobs, false) THEN
    RAISE EXCEPTION 'Este usuario no tiene perfil profesional para rechazar.';
  END IF;

  IF coalesce(v_status, 'none') NOT IN ('pending', 'accepted', 'paused', 'none') THEN
    RAISE EXCEPTION 'No se puede rechazar un profesional en estado %.', v_status;
  END IF;

  UPDATE public.profiles
  SET
    professional_status = 'rejected',
    professional_reviewed_at = now(),
    professional_reviewed_by = auth.uid(),
    professional_rejection_reason = v_reason,
    updated_at = now()
  WHERE id = p_user_id;

  RETURN public.admin_get_user_detail(p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_row jsonb;
  v_jobs int;
  v_mode text;
BEGIN
  PERFORM public._admin_require();

  v_jobs := public._worker_job_history_count(p_user_id);

  SELECT CASE
    WHEN p.professional_deactivated_at IS NOT NULL THEN 'professional'
    WHEN EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
      OR coalesce(p.coverage_km, 0) > 0 THEN 'professional'
    ELSE 'client'
  END
  INTO v_mode
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT jsonb_build_object(
    'id', p.id,
    'nombre', p.nombre,
    'apellido', p.apellido,
    'email', coalesce(u.email, ''),
    'email_confirmed', (u.email_confirmed_at IS NOT NULL),
    'telefono', coalesce(p.telefono, ''),
    'avatar_url', p.avatar_url,
    'professional_status', CASE
      WHEN p.professional_deactivated_at IS NOT NULL THEN 'deactivated'
      ELSE coalesce(nullif(btrim(p.professional_status), ''), 'none')
    END,
    'professional_rejection_reason', p.professional_rejection_reason,
    'rating_average', coalesce(p.rating_average, 0),
    'review_count', coalesce(p.review_count, 0),
    'billing_total', public._admin_user_billing_total(p.id, coalesce(v_mode, 'client')),
    'billing_mode', coalesce(v_mode, 'client'),
    'billing_client_total', public._admin_user_billing_total(p.id, 'client'),
    'billing_professional_total', public._admin_user_billing_total(p.id, 'professional'),
    'jobs_finished', (
      SELECT count(*)::int FROM public.contrataciones c
      WHERE c.worker_id = p.id AND c.estado_trabajo::text = 'finalizado'
    ),
    'jobs_history_count', v_jobs,
    'is_new', (
      (
        p.professional_deactivated_at IS NULL
        AND (
          EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
          OR coalesce(p.coverage_km, 0) > 0
        )
        AND v_jobs < 2
      )
    ),
    'trades', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', j.nombre_oficio,
        'description', coalesce(j.descripcion, ''),
        'is_primary', j.es_principal,
        'years_experience', j.years_experience
      ) ORDER BY j.es_principal DESC, j.nombre_oficio)
      FROM public.jobs j
      WHERE j.user_id = p.id
    ), '[]'::jsonb),
    'professional_deactivated_at', p.professional_deactivated_at,
    'professional_deactivated_by', p.professional_deactivated_by,
    'deactivated_at', p.deactivated_at,
    'deactivated_by', p.deactivated_by,
    'deactivation_reason', p.deactivation_reason,
    'created_at', p.created_at
  )
  INTO v_row
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.id = p_user_id;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  RETURN v_row;
END;
$function$;

-- Listado de admin. El estado sale de la columna, no de "tiene oficios".
-- is_active_pro sigue metiendo al pending en la solapa Profesionales para
-- que el admin lo vea y lo apruebe o lo rechace.
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_kind text,
  p_search text DEFAULT ''::text,
  p_trade text DEFAULT ''::text,
  p_sort text DEFAULT 'name_asc'::text,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_search text := btrim(coalesce(p_search, ''));
  v_trade text := btrim(coalesce(p_trade, ''));
  v_sort text := lower(btrim(coalesce(p_sort, 'name_asc')));
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
BEGIN
  PERFORM public._admin_require();

  IF v_kind NOT IN ('clients', 'professionals', 'deactivated') THEN
    RAISE EXCEPTION 'p_kind inválido';
  END IF;

  IF v_sort NOT IN ('name_asc', 'name_desc', 'billing_asc', 'billing_desc') THEN
    v_sort := 'name_asc';
  END IF;

  DROP TABLE IF EXISTS _admin_user_rows;
  CREATE TEMP TABLE _admin_user_rows ON COMMIT DROP AS
  WITH base AS (
    SELECT
      p.id,
      p.nombre,
      p.apellido,
      coalesce(u.email, '') AS email,
      (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
      coalesce(p.telefono, '') AS telefono,
      p.created_at,
      p.coverage_km,
      p.deactivated_at,
      p.deactivated_by,
      p.professional_deactivated_at,
      p.professional_deactivated_by,
      p.deactivation_reason,
      p.professional_jobs_backup,
      u.deleted_at AS auth_deleted_at,
      u.banned_until,
      (u.id IS NOT NULL) AS auth_exists,
      p.professional_status AS profile_status,
      (
        EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
        OR coalesce(p.coverage_km, 0) > 0
      ) AS is_active_pro,
      (
        p.professional_deactivated_at IS NOT NULL
        OR (
          p.professional_jobs_backup IS NOT NULL
          AND jsonb_typeof(p.professional_jobs_backup) = 'array'
          AND jsonb_array_length(p.professional_jobs_backup) > 0
        )
      ) AS was_pro,
      public._worker_job_history_count(p.id) AS jobs_history_count,
      (
        SELECT count(*)::int
        FROM public.contrataciones c
        WHERE c.worker_id = p.id
          AND c.estado_trabajo::text = 'finalizado'
      ) AS jobs_finished,
      CASE
        WHEN v_kind = 'professionals' THEN public._admin_user_billing_total(p.id, 'professional')
        WHEN v_kind = 'deactivated' AND (
          p.professional_deactivated_at IS NOT NULL
          OR (
            p.professional_jobs_backup IS NOT NULL
            AND jsonb_typeof(p.professional_jobs_backup) = 'array'
            AND jsonb_array_length(p.professional_jobs_backup) > 0
          )
          OR coalesce(p.professional_status, '') = 'deactivated'
        ) THEN public._admin_user_billing_total(p.id, 'professional')
        ELSE public._admin_user_billing_total(p.id, 'client')
      END AS billing_total,
      coalesce(p.rating_average, 0) AS rating_average,
      coalesce(p.review_count, 0) AS review_count,
      CASE
        WHEN p.professional_deactivated_at IS NOT NULL THEN 'deactivated'
        ELSE coalesce(nullif(btrim(p.professional_status), ''), 'none')
      END AS professional_status
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
  ),
  filtered AS (
    SELECT *
    FROM base b
    WHERE
      CASE v_kind
        WHEN 'clients' THEN
          b.deactivated_at IS NULL
          AND b.auth_deleted_at IS NULL
          AND (b.banned_until IS NULL OR b.banned_until < timestamptz '2099-01-01')
        WHEN 'professionals' THEN
          b.deactivated_at IS NULL
          AND b.auth_deleted_at IS NULL
          AND b.professional_deactivated_at IS NULL
          AND b.profile_status IS DISTINCT FROM 'deactivated'
          AND (b.banned_until IS NULL OR b.banned_until < timestamptz '2099-01-01')
          AND b.is_active_pro
        ELSE
          b.deactivated_at IS NOT NULL
          OR b.professional_deactivated_at IS NOT NULL
          OR b.auth_deleted_at IS NOT NULL
          OR b.profile_status = 'deactivated'
          OR (b.banned_until IS NOT NULL AND b.banned_until >= timestamptz '2099-01-01')
      END
      AND (
        v_search = ''
        OR b.nombre ILIKE '%' || v_search || '%'
        OR b.apellido ILIKE '%' || v_search || '%'
        OR (b.nombre || ' ' || b.apellido) ILIKE '%' || v_search || '%'
        OR b.email ILIKE '%' || v_search || '%'
      )
      AND (
        v_kind <> 'professionals'
        OR v_trade = ''
        OR EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.user_id = b.id AND j.nombre_oficio = v_trade
        )
      )
  )
  SELECT * FROM filtered;

  SELECT count(*)::int INTO v_total FROM _admin_user_rows;

  IF v_kind = 'deactivated' THEN
    SELECT coalesce(jsonb_agg((to_jsonb(x) - 'rn') ORDER BY x.rn), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT
        s.id,
        s.nombre,
        s.apellido,
        s.email,
        s.user_type,
        s.deactivated_at,
        s.professional_deactivated_at,
        s.origin,
        s.deactivation_reason,
        s.billing_total,
        s.created_at,
        s.rn
      FROM (
        SELECT
          f.id,
          f.nombre,
          f.apellido,
          f.email,
          CASE
            WHEN f.profile_status = 'deactivated'
              OR f.was_pro
              OR f.professional_deactivated_at IS NOT NULL
            THEN 'professional'
            ELSE 'client'
          END AS user_type,
          coalesce(f.deactivated_at, f.professional_deactivated_at, f.auth_deleted_at) AS deactivated_at,
          f.professional_deactivated_at,
          CASE
            WHEN f.deactivated_at IS NOT NULL THEN coalesce(f.deactivated_by, 'admin')
            WHEN f.professional_deactivated_at IS NOT NULL THEN coalesce(f.professional_deactivated_by, 'user')
            WHEN f.auth_deleted_at IS NOT NULL THEN 'user'
            ELSE 'user'
          END AS origin,
          CASE
            WHEN f.deactivated_at IS NOT NULL AND coalesce(f.deactivated_by, 'admin') = 'admin'
              THEN f.deactivation_reason
            WHEN f.professional_deactivated_at IS NOT NULL
              AND coalesce(f.professional_deactivated_by, 'user') = 'admin'
              THEN f.deactivation_reason
            ELSE NULL
          END AS deactivation_reason,
          f.billing_total,
          f.created_at,
          row_number() OVER (
            ORDER BY
              CASE WHEN v_sort = 'name_asc' THEN lower(f.nombre || ' ' || f.apellido) END ASC,
              CASE WHEN v_sort = 'name_desc' THEN lower(f.nombre || ' ' || f.apellido) END DESC,
              CASE WHEN v_sort = 'billing_asc' THEN f.billing_total END ASC,
              CASE WHEN v_sort = 'billing_desc' THEN f.billing_total END DESC,
              f.created_at DESC
          ) AS rn
        FROM _admin_user_rows f
      ) s
      WHERE s.rn > v_offset AND s.rn <= v_offset + v_limit
    ) x;
  ELSIF v_kind = 'professionals' THEN
    SELECT coalesce(jsonb_agg((to_jsonb(x) - 'rn') ORDER BY x.rn), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT
        s.id,
        s.nombre,
        s.apellido,
        s.email,
        s.email_confirmed,
        s.professional_status,
        s.rating_average,
        s.review_count,
        s.billing_total,
        s.created_at,
        s.jobs_history_count,
        s.is_new,
        s.trades,
        s.rn
      FROM (
        SELECT
          f.id,
          f.nombre,
          f.apellido,
          f.email,
          f.email_confirmed,
          f.professional_status,
          f.rating_average,
          f.review_count,
          f.billing_total,
          f.created_at,
          f.jobs_history_count,
          (f.jobs_history_count < 2) AS is_new,
          coalesce((
            SELECT jsonb_agg(j.nombre_oficio ORDER BY j.es_principal DESC, j.nombre_oficio)
            FROM public.jobs j
            WHERE j.user_id = f.id
          ), '[]'::jsonb) AS trades,
          row_number() OVER (
            ORDER BY
              CASE WHEN v_sort = 'name_asc' THEN lower(f.nombre || ' ' || f.apellido) END ASC,
              CASE WHEN v_sort = 'name_desc' THEN lower(f.nombre || ' ' || f.apellido) END DESC,
              CASE WHEN v_sort = 'billing_asc' THEN f.billing_total END ASC,
              CASE WHEN v_sort = 'billing_desc' THEN f.billing_total END DESC,
              f.created_at DESC
          ) AS rn
        FROM _admin_user_rows f
      ) s
      WHERE s.rn > v_offset AND s.rn <= v_offset + v_limit
    ) x;
  ELSE
    SELECT coalesce(jsonb_agg((to_jsonb(x) - 'rn') ORDER BY x.rn), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT
        s.id,
        s.nombre,
        s.apellido,
        s.email,
        s.email_confirmed,
        s.telefono,
        s.created_at,
        s.billing_total,
        s.rn
      FROM (
        SELECT
          f.id,
          f.nombre,
          f.apellido,
          f.email,
          f.email_confirmed,
          f.telefono,
          f.created_at,
          f.billing_total,
          row_number() OVER (
            ORDER BY
              CASE WHEN v_sort = 'name_asc' THEN lower(f.nombre || ' ' || f.apellido) END ASC,
              CASE WHEN v_sort = 'name_desc' THEN lower(f.nombre || ' ' || f.apellido) END DESC,
              CASE WHEN v_sort = 'billing_asc' THEN f.billing_total END ASC,
              CASE WHEN v_sort = 'billing_desc' THEN f.billing_total END DESC,
              f.created_at DESC
          ) AS rn
        FROM _admin_user_rows f
      ) s
      WHERE s.rn > v_offset AND s.rn <= v_offset + v_limit
    ) x;
  END IF;

  RETURN jsonb_build_object('total', v_total, 'rows', coalesce(v_rows, '[]'::jsonb));
END;
$function$;

-- Pasa a pending solo none / rejected / deactivated, con mail confirmado y oficios.
-- accepted, pending y paused no se tocan. Nadie queda accepted acá.
CREATE OR REPLACE FUNCTION public.maybe_set_professional_pending(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_email_confirmed timestamptz;
  v_has_jobs boolean;
  v_status text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed
  FROM auth.users WHERE id = p_user_id;

  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p_user_id)
  INTO v_has_jobs;

  IF NOT v_has_jobs THEN
    RETURN;
  END IF;

  SELECT professional_status INTO v_status
  FROM public.profiles WHERE id = p_user_id;

  IF v_status IN ('accepted', 'pending', 'paused') THEN
    RETURN;
  END IF;

  IF v_email_confirmed IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET
    professional_status = 'pending',
    professional_reviewed_at = NULL,
    professional_reviewed_by = NULL,
    professional_rejection_reason = NULL,
    professional_deactivated_at = NULL,
    updated_at = now()
  WHERE id = p_user_id
    AND professional_status IN ('none', 'rejected', 'deactivated');
END;
$function$;

REVOKE ALL ON FUNCTION public.maybe_set_professional_pending(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maybe_set_professional_pending(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_jobs_maybe_professional_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.maybe_set_professional_pending(NEW.user_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_jobs_professional_pending ON public.jobs;
CREATE TRIGGER trg_jobs_professional_pending
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_jobs_maybe_professional_pending();

-- Al validar el mail, si ya hay oficios, pasa a pending.
-- maybe_set_professional_pending no toca accepted, paused ni pending.
CREATE OR REPLACE FUNCTION public.trg_auth_user_link_professional_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NEW.deleted_at IS NULL
    AND NEW.email_confirmed_at IS NOT NULL
    AND (TG_OP = 'INSERT' OR OLD.email_confirmed_at IS NULL)
  THEN
    PERFORM public.link_professional_history_for_user(NEW.id);
    PERFORM public.maybe_set_professional_pending(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DO $ensure_auth_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_auth_user_link_professional_history'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_link_professional_history
      AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.trg_auth_user_link_professional_history();
  END IF;
END;
$ensure_auth_trigger$;

-- La búsqueda pública y la del cliente solo listan accepted.
-- Si alguien las dejó sin ese filtro, esta migración falla en vez de publicar pending.
DO $search_accepted_only$
DECLARE
  v_public text := pg_get_functiondef(
    'public.search_workers_public(text,text,text,integer)'::regprocedure
  );
  v_client text := pg_get_functiondef(
    'public.search_workers_for_client(double precision,double precision,text,text[],uuid,integer)'::regprocedure
  );
BEGIN
  IF position('professional_status = ''accepted''' IN v_public) = 0
     OR position('professional_status = ''accepted''' IN v_client) = 0 THEN
    RAISE EXCEPTION 'search_workers debe filtrar professional_status = accepted';
  END IF;
END;
$search_accepted_only$;

-- Cuenta de prueba que el admin veía aprobada sin revisión.
-- No pisa una aprobación real (professional_reviewed_by ya cargado).
UPDATE public.profiles AS p
SET
  professional_status = 'pending',
  professional_reviewed_at = NULL,
  professional_reviewed_by = NULL,
  professional_rejection_reason = NULL,
  updated_at = now()
FROM auth.users AS u
WHERE u.id = p.id
  AND lower(u.email) IN (
    'pedidos.lanegrita@gmail.com',
    'pedidos.lanegritasn@gmail.com'
  )
  AND p.professional_reviewed_by IS NULL
  AND p.professional_status IS DISTINCT FROM 'pending'
  AND p.professional_status IN ('accepted', 'none');
