-- Guardado robusto de oficios + fotos (evita borrar jobs por RLS desde el cliente).
-- Objetivo:
-- - Persistir years_experience y photo_urls si existen columnas.
-- - Fallback automático si el schema todavía no tiene esas columnas (undefined_column).
-- - SECURITY DEFINER para no depender de políticas RLS del cliente.

CREATE OR REPLACE FUNCTION public.update_worker_jobs(
  p_jobs JSONB
) RETURNS VOID AS $$
DECLARE
  uid UUID;
  has_primary BOOLEAN;
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

  BEGIN
    -- Versión moderna: years_experience + photo_urls.
    INSERT INTO public.jobs (user_id, nombre_oficio, descripcion, foto_url, es_principal, years_experience, photo_urls)
    SELECT
      uid,
      NULLIF(trim(j->>'name'), ''),
      COALESCE(trim(j->>'description'), ''),
      -- Compat: si no mandan photoUrl, usamos la primera de photoUrls.
      NULLIF(
        COALESCE(
          NULLIF(trim(j->>'photoUrl'), ''),
          NULLIF( trim( (j->'photoUrls'->>0) ), '' )
        ),
        ''
      ),
      CASE
        WHEN has_primary THEN COALESCE((j->>'isPrimary')::boolean, false)
        ELSE (ord = 1)
      END,
      GREATEST(1, LEAST(60, COALESCE(NULLIF((j->>'yearsExperience'), '')::int, 1))),
      COALESCE(
        (SELECT array_agg(value::text)
         FROM jsonb_array_elements_text(COALESCE(j->'photoUrls', '[]'::jsonb)) value),
        '{}'::text[]
      )
    FROM (
      SELECT
        j,
        row_number() OVER () AS ord
      FROM jsonb_array_elements(p_jobs) j
      WHERE NULLIF(trim(j->>'name'), '') IS NOT NULL
      LIMIT 5
    ) s;
  EXCEPTION
    WHEN undefined_column THEN
      -- Schema legacy: no years_experience y/o no photo_urls.
      INSERT INTO public.jobs (user_id, nombre_oficio, descripcion, foto_url, es_principal)
      SELECT
        uid,
        NULLIF(trim(j->>'name'), ''),
        COALESCE(trim(j->>'description'), ''),
        NULLIF(trim(j->>'photoUrl'), ''),
        CASE
          WHEN has_primary THEN COALESCE((j->>'isPrimary')::boolean, false)
          ELSE (ord = 1)
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.update_worker_jobs(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.update_worker_jobs(JSONB) TO authenticated;

