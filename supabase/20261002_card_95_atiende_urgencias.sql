-- Card 95. El profesional marca «Atiendo urgencias» y el cliente lo ve en la búsqueda.
-- NO ejecutar desde la app: aplicar a mano y diffear contra pg_get_functiondef.
--
-- Columna nueva, default false. No hay GRANT de UPDATE ni de INSERT sobre la
-- columna: el único escritor es set_my_atiende_urgencias (auth.uid()).
-- #100/#120: el cliente no escribe profiles directo.
--
-- search_workers_for_client y search_workers_public se recrean desde el cuerpo
-- de producción (pg_get_functiondef, 2026-10-02). Cambia el RETURNS TABLE
-- (columna al final), así que hace falta DROP + CREATE. No cambia el WHERE,
-- la distancia ni el ORDER BY. search_workers_for_client sigue devolviendo
-- apellido NULL (regla #117). Grants iguales a los de producción.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS atiende_urgencias boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.atiende_urgencias IS
  'El profesional declara que atiende urgencias en cualquier horario. Solo lo escribe set_my_atiende_urgencias.';

REVOKE ALL (atiende_urgencias) ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (atiende_urgencias) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_atiende_urgencias(p_value boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_value IS NULL THEN
    RAISE EXCEPTION 'p_value required';
  END IF;

  UPDATE public.profiles
  SET
    atiende_urgencias = p_value,
    updated_at = now()
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_atiende_urgencias(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_atiende_urgencias(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_atiende_urgencias(boolean) TO authenticated;

-- Cambiar RETURNS TABLE exige DROP. Misma firma de argumentos.
DROP FUNCTION IF EXISTS public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer);

CREATE FUNCTION public.search_workers_for_client(
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
  total_jobs_done integer,
  atiende_urgencias boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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
      coalesce(p.total_jobs_done, 0) AS total_jobs_done,
      p.atiende_urgencias
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
    b.total_jobs_done,
    b.atiende_urgencias
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

COMMENT ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) IS
  'Búsqueda de profesionales para el cliente. Devuelve el nombre y apellido NULL. No busca por apellido. Distancia redondeada a 0,1 km y coordenadas redondeadas a ~1 km. Incluye atiende_urgencias sin cambiar filtros, distancia ni orden.';

REVOKE ALL ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) TO service_role;

DROP FUNCTION IF EXISTS public.search_workers_public(text, text, text, integer);

CREATE FUNCTION public.search_workers_public(
  p_query text DEFAULT ''::text,
  p_category text DEFAULT NULL::text,
  p_zona text DEFAULT NULL::text,
  p_limit integer DEFAULT 48
)
RETURNS TABLE (
  id uuid,
  nombre text,
  oficio text,
  rating numeric,
  resenas_count integer,
  avatar text,
  zona text,
  all_trades text[],
  total_jobs_done integer,
  atiende_urgencias boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH lim AS (
    SELECT least(greatest(coalesce(p_limit, 48), 1), 80) AS n
  ),
  base AS (
    SELECT
      p.id,
      NULLIF(trim(split_part(coalesce(p.nombre, ''), ' ', 1)), '') AS nombre,
      (
        SELECT j2.nombre_oficio
        FROM public.jobs j2
        WHERE j2.user_id = p.id
        ORDER BY j2.es_principal DESC NULLS LAST, j2.created_at
        LIMIT 1
      ) AS oficio,
      coalesce(p.rating_average, 0)::numeric AS rating,
      coalesce(p.review_count, 0)::int AS resenas_count,
      NULLIF(trim(coalesce(p.avatar_url, '')), '') AS avatar,
      NULLIF(
        trim(regexp_replace(coalesce(p.direccion_texto, ''), '^[^,]*,\s*', '')),
        ''
      ) AS zona,
      coalesce(
        (
          SELECT array_agg(j3.nombre_oficio ORDER BY j3.nombre_oficio)
          FROM public.jobs j3
          WHERE j3.user_id = p.id
        ),
        '{}'::text[]
      ) AS all_trades,
      coalesce(p.total_jobs_done, 0)::int AS total_jobs_done,
      p.atiende_urgencias
    FROM public.profiles p
    WHERE p.professional_status = 'accepted'
      AND p.coverage_km IS NOT NULL
      AND p.coverage_km > 0
      AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
  )
  SELECT
    b.id,
    coalesce(b.nombre, 'Profesional') AS nombre,
    coalesce(NULLIF(trim(b.oficio), ''), 'Servicios') AS oficio,
    b.rating,
    b.resenas_count,
    b.avatar,
    b.zona,
    b.all_trades,
    b.total_jobs_done,
    b.atiende_urgencias
  FROM base b
  WHERE (
      coalesce(trim(p_query), '') = ''
      OR b.nombre ILIKE '%' || trim(p_query) || '%'
      OR b.oficio ILIKE '%' || trim(p_query) || '%'
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.user_id = b.id
          AND (
            j.nombre_oficio ILIKE '%' || trim(p_query) || '%'
            OR coalesce(j.descripcion, '') ILIKE '%' || trim(p_query) || '%'
          )
      )
    )
    AND (
      coalesce(trim(p_category), '') = ''
      OR b.all_trades && ARRAY[trim(p_category)]::text[]
      OR b.oficio ILIKE trim(p_category)
    )
    AND (
      coalesce(trim(p_zona), '') = ''
      OR coalesce(b.zona, '') ILIKE '%' || trim(p_zona) || '%'
    )
  ORDER BY b.rating DESC, b.resenas_count DESC, b.nombre
  LIMIT (SELECT n FROM lim);
$$;

REVOKE ALL ON FUNCTION public.search_workers_public(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_workers_public(text, text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_workers_public(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workers_public(text, text, text, integer) TO service_role;
