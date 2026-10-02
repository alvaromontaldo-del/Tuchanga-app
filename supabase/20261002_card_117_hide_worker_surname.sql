-- Card 117. El cliente no ve el apellido ni la inicial del profesional.
-- NO ejecutar desde la app: aplicar a mano y diffear contra producción.
-- Misma firma, SECURITY DEFINER, search_path y grants.
-- Ambas funciones se reconstruyeron desde producción (pg_get_functiondef, 2026-10-02).
-- search_workers_for_client: solo cambia la columna apellido (NULL) y se quita
--   la búsqueda por apellido.
-- list_favorites: solo cambia la columna de salida apellido (NULL).

CREATE OR REPLACE FUNCTION public.search_workers_for_client(
  p_client_lat double precision,
  p_client_lng double precision,
  p_query text DEFAULT '',
  p_category_names text[] DEFAULT NULL,
  p_exclude_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 80
)
RETURNS TABLE (
  profile_id uuid,
  nombre text,
  apellido text,
  avatar_url text,
  lat double precision,
  lng double precision,
  coverage_km integer,
  distance_km double precision,
  primary_trade text,
  all_trades text[],
  summary_jobs text,
  rating_average numeric,
  review_count integer,
  total_jobs_done integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH client_pt AS (
    SELECT st_setsrid(st_makepoint(p_client_lng, p_client_lat), 4326)::geography AS g
  ),
  lim AS (
    SELECT least(greatest(coalesce(p_limit, 80), 1), 100) AS n
  ),
  base AS (
    SELECT
      p.id AS profile_id,
      p.nombre,
      p.apellido AS apellido_full,
      p.avatar_url,
      st_y(p.location::geometry) AS lat_exact,
      st_x(p.location::geometry) AS lng_exact,
      p.coverage_km,
      st_distance(p.location, (SELECT g FROM client_pt), false) / 1000.0 AS distance_exact,
      (
        SELECT j2.nombre_oficio
        FROM public.jobs j2
        WHERE j2.user_id = p.id
        ORDER BY j2.es_principal DESC, j2.nombre_oficio
        LIMIT 1
      ) AS primary_trade,
      (
        SELECT array_agg(j3.nombre_oficio ORDER BY j3.es_principal DESC, j3.nombre_oficio)
        FROM public.jobs j3
        WHERE j3.user_id = p.id
      ) AS all_trades,
      (
        SELECT string_agg(j4.nombre_oficio || ': ' || coalesce(j4.descripcion, ''), ' · ')
        FROM public.jobs j4
        WHERE j4.user_id = p.id
      ) AS summary_jobs,
      coalesce(p.rating_average, 0) AS rating_average,
      coalesce(p.review_count, 0) AS review_count,
      coalesce(p.total_jobs_done, 0) AS total_jobs_done
    FROM public.profiles p
    WHERE p.professional_status = 'accepted'
      AND p.location IS NOT NULL
      AND p.coverage_km IS NOT NULL
      AND p.coverage_km > 0
      AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
      AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
  )
  SELECT
    b.profile_id,
    b.nombre,
    NULL::text AS apellido,
    b.avatar_url,
    round(b.lat_exact::numeric, 2)::double precision AS lat,
    round(b.lng_exact::numeric, 2)::double precision AS lng,
    b.coverage_km,
    round(b.distance_exact::numeric, 1)::double precision AS distance_km,
    b.primary_trade,
    b.all_trades,
    b.summary_jobs,
    b.rating_average,
    b.review_count,
    b.total_jobs_done
  FROM base b
  WHERE b.distance_exact <= b.coverage_km
    AND (
      coalesce(trim(p_query), '') = ''
      OR b.nombre ILIKE '%' || trim(p_query) || '%'
      OR b.primary_trade ILIKE '%' || trim(p_query) || '%'
      OR exists (
        SELECT 1 FROM unnest(coalesce(b.all_trades, array[]::text[])) t
        WHERE t ILIKE '%' || trim(p_query) || '%'
      )
      OR coalesce(b.summary_jobs, '') ILIKE '%' || trim(p_query) || '%'
    )
    AND (
      p_category_names IS NULL
      OR cardinality(p_category_names) = 0
      OR exists (
        SELECT 1
        FROM unnest(coalesce(b.all_trades, array[]::text[])) t
        WHERE t = ANY (p_category_names)
      )
    )
  ORDER BY b.distance_exact ASC, b.rating_average DESC NULLS LAST
  LIMIT (SELECT n FROM lim);
$$;

COMMENT ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) IS
  'Búsqueda de profesionales para el cliente. Devuelve el nombre y apellido NULL. No busca por apellido. Distancia redondeada a 0,1 km y coordenadas redondeadas a ~1 km.';

REVOKE ALL ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) TO anon;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) TO service_role;

-- list_favorites: cuerpo de producción (pg_get_functiondef 2026-10-02, con
-- rating_average / review_count / total_jobs_done). Solo cambia la columna de
-- salida apellido a NULL. Grants sin cambios (los de producción).
CREATE OR REPLACE FUNCTION public.list_favorites()
 RETURNS TABLE(profile_id uuid, nombre text, apellido text, avatar_url text, primary_trade text, all_trades text[], summary_jobs text, rating_average numeric, review_count integer, total_jobs_done integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      p.id AS profile_id,
      p.nombre,
      p.apellido,
      p.avatar_url,
      coalesce(p.rating_average, 0) AS rating_average,
      coalesce(p.review_count, 0) AS review_count,
      coalesce(p.total_jobs_done, 0) AS total_jobs_done,
      (
        SELECT j2.nombre_oficio
        FROM public.jobs j2
        WHERE j2.user_id = p.id
        ORDER BY j2.es_principal DESC, j2.created_at
        LIMIT 1
      ) AS primary_trade,
      coalesce(
        (
          SELECT array_agg(j3.nombre_oficio ORDER BY j3.nombre_oficio)
          FROM public.jobs j3
          WHERE j3.user_id = p.id
        ),
        '{}'::text[]
      ) AS all_trades,
      (
        SELECT string_agg(x.nombre_oficio || ': ' || left(coalesce(x.descripcion, ''), 100), ' · ' ORDER BY x.ord)
        FROM (
          SELECT j.nombre_oficio, j.descripcion, row_number() OVER (ORDER BY j.es_principal DESC, j.created_at) AS ord
          FROM public.jobs j
          WHERE j.user_id = p.id
        ) x
        WHERE x.ord <= 3
      ) AS summary_jobs,
      f.created_at
    FROM public.favorites f
    JOIN public.profiles p ON p.id = f.professional_id
    WHERE f.user_id = auth.uid()
  )
  SELECT
    b.profile_id,
    b.nombre,
    NULL::text AS apellido,
    b.avatar_url,
    b.primary_trade,
    b.all_trades,
    b.summary_jobs,
    b.rating_average,
    b.review_count,
    b.total_jobs_done
  FROM base b
  ORDER BY b.created_at DESC;
$function$;
