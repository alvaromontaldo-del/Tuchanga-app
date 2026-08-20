-- Restaurar persistencia de photo_urls en update_worker_jobs.
-- La migración 20260428183000 reescribió el RPC y omitió photo_urls;
-- las fotos se subían a Storage pero jobs.photo_urls quedaba vacío,
-- por eso el cliente no las veía en el perfil público del profesional.

CREATE OR REPLACE FUNCTION public.update_worker_jobs(p_jobs jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  has_primary boolean;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM public.jobs WHERE user_id = uid;

  IF p_jobs IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_jobs) j
    WHERE COALESCE((j->>'isPrimary')::boolean, false) = true
  ) INTO has_primary;

  INSERT INTO public.jobs (
    user_id,
    nombre_oficio,
    descripcion,
    foto_url,
    es_principal,
    years_experience,
    photo_urls
  )
  SELECT
    uid,
    NULLIF(trim(j->>'name'), ''),
    COALESCE(trim(j->>'description'), ''),
    NULLIF(
      COALESCE(
        NULLIF(trim(j->>'photoUrl'), ''),
        NULLIF(trim(j->'photoUrls'->>0), '')
      ),
      ''
    ),
    CASE
      WHEN has_primary THEN COALESCE((j->>'isPrimary')::boolean, false)
      ELSE (ord = 1)
    END,
    CASE
      WHEN NULLIF(trim(j->>'yearsExperience'), '') IS NULL THEN NULL
      ELSE GREATEST(1, LEAST(50, (j->>'yearsExperience')::int))
    END,
    COALESCE(
      (
        SELECT array_agg(value::text)
        FROM jsonb_array_elements_text(COALESCE(j->'photoUrls', '[]'::jsonb)) AS value
      ),
      CASE
        WHEN NULLIF(trim(j->>'photoUrl'), '') IS NOT NULL
          THEN ARRAY[NULLIF(trim(j->>'photoUrl'), '')]::text[]
        ELSE '{}'::text[]
      END
    )
  FROM (
    SELECT
      j,
      row_number() OVER () AS ord
    FROM jsonb_array_elements(p_jobs) j
    WHERE NULLIF(trim(j->>'name'), '') IS NOT NULL
    LIMIT 5
  ) s;
END;
$$;

REVOKE ALL ON FUNCTION public.update_worker_jobs(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_worker_jobs(jsonb) TO authenticated;
