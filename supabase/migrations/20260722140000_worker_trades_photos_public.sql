-- 1) Asegurar que update_worker_jobs persiste photo_urls
-- 2) Backfill: si hay foto_url y photo_urls vacío, copiar
-- 3) RPC pública para leer oficios+fotos del profesional (SECURITY DEFINER)

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
    CASE
      WHEN jsonb_typeof(j->'photoUrls') = 'array'
           AND jsonb_array_length(j->'photoUrls') > 0
        THEN COALESCE(
          (
            SELECT array_agg(NULLIF(trim(value), '') ORDER BY ord)
            FROM jsonb_array_elements_text(j->'photoUrls') WITH ORDINALITY AS t(value, ord)
            WHERE NULLIF(trim(value), '') IS NOT NULL
          ),
          '{}'::text[]
        )
      WHEN NULLIF(trim(j->>'photoUrl'), '') IS NOT NULL
        THEN ARRAY[NULLIF(trim(j->>'photoUrl'), '')]::text[]
      ELSE '{}'::text[]
    END
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

-- Backfill desde foto_url legacy
UPDATE public.jobs
SET photo_urls = ARRAY[foto_url]
WHERE foto_url IS NOT NULL
  AND trim(foto_url) <> ''
  AND (photo_urls IS NULL OR cardinality(photo_urls) IS NULL OR cardinality(photo_urls) = 0);

-- Lectura pública de oficios (incluye fotos) para el perfil del profesional
CREATE OR REPLACE FUNCTION public.fetch_worker_trades(p_worker_id uuid)
RETURNS TABLE (
  nombre_oficio text,
  descripcion text,
  es_principal boolean,
  years_experience int,
  foto_url text,
  photo_urls text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.nombre_oficio,
    j.descripcion,
    COALESCE(j.es_principal, false) AS es_principal,
    j.years_experience,
    NULLIF(trim(COALESCE(j.foto_url, '')), '') AS foto_url,
    CASE
      WHEN j.photo_urls IS NOT NULL AND cardinality(j.photo_urls) > 0 THEN j.photo_urls
      WHEN NULLIF(trim(COALESCE(j.foto_url, '')), '') IS NOT NULL THEN ARRAY[trim(j.foto_url)]
      ELSE '{}'::text[]
    END AS photo_urls
  FROM public.jobs j
  WHERE j.user_id = p_worker_id
  ORDER BY j.es_principal DESC NULLS LAST, j.nombre_oficio ASC
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION public.fetch_worker_trades(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_worker_trades(uuid) TO authenticated, anon;
