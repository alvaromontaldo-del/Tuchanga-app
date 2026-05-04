-- #20: Persistir años de experiencia por oficio.
-- Se usa en el perfil público y en la ficha del profesional.

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS years_experience INTEGER NOT NULL DEFAULT 1;

-- Normalizar datos existentes (evitar 0 / null).
UPDATE public.jobs
SET years_experience = 1
WHERE years_experience IS NULL OR years_experience < 1;

-- RPC: aceptar y persistir yearsExperience desde JSON.
CREATE OR REPLACE FUNCTION public.update_worker_jobs (
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

  INSERT INTO public.jobs (user_id, nombre_oficio, descripcion, foto_url, es_principal, years_experience)
  SELECT
    uid,
    NULLIF(trim(j->>'name'), ''),
    COALESCE(trim(j->>'description'), ''),
    NULLIF(trim(j->>'photoUrl'), ''),
    CASE
      WHEN has_primary THEN COALESCE((j->>'isPrimary')::boolean, false)
      ELSE (ord = 1)
    END,
    GREATEST(1, LEAST(60, COALESCE(NULLIF((j->>'yearsExperience'), '')::int, 1)))
  FROM (
    SELECT
      j,
      row_number() OVER () AS ord
    FROM jsonb_array_elements(p_jobs) j
    WHERE NULLIF(trim(j->>'name'), '') IS NOT NULL
    LIMIT 5
  ) s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.update_worker_jobs(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.update_worker_jobs(JSONB) TO authenticated;

