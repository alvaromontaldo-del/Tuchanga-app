-- Alta profesional: después de validar el mail el estado es pending.
-- El listado de admin reescribía el estado y devolvía 'accepted' a cualquiera
-- con oficios o cobertura, así que un alta nueva figuraba aprobada.
-- Aprobar y rechazar siguen siendo del admin. Este archivo no aprueba solo.

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

-- admin_list_users vive en la base. Si todavía traduce "tiene oficios" a accepted,
-- lo deja en el valor de la columna. Si ya está corregido, no hace nada.
DO $patch$
DECLARE
  v_sql text := pg_get_functiondef('public.admin_list_users(text,text,text,text,integer,integer)'::regprocedure);
  v_bad text := $bad$CASE
        WHEN p.professional_deactivated_at IS NOT NULL THEN 'deactivated'
        WHEN EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
          OR coalesce(p.coverage_km, 0) > 0 THEN 'accepted'
        ELSE 'none'
      END AS professional_status$bad$;
  v_good text := $good$CASE
        WHEN p.professional_deactivated_at IS NOT NULL THEN 'deactivated'
        ELSE coalesce(nullif(btrim(p.professional_status), ''), 'none')
      END AS professional_status$good$;
BEGIN
  IF position(v_bad in v_sql) > 0 THEN
    EXECUTE replace(v_sql, v_bad, v_good);
  ELSIF position('ELSE coalesce(nullif(btrim(p.professional_status)' in v_sql) = 0 THEN
    RAISE EXCEPTION 'admin_list_users no expone professional_status real';
  END IF;
END;
$patch$;

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
