-- Sincronizar oficios del trabajador autenticado en public.jobs.
-- Motivo: la búsqueda `search_workers_for_client` exige que exista al menos un job para el perfil.
-- Esta RPC evita problemas de RLS/clients y garantiza consistencia (reemplaza el set completo).

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

  -- Limpiar set anterior
  DELETE FROM public.jobs WHERE user_id = uid;

  IF p_jobs IS NULL THEN
    RETURN;
  END IF;

  -- ¿Hay principal?
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_jobs) j
    WHERE COALESCE((j->>'isPrimary')::boolean, false) = true
  ) INTO has_primary;

  -- Insertar (máx 5)
  INSERT INTO public.jobs (user_id, nombre_oficio, descripcion, foto_url, es_principal)
  SELECT
    uid,
    NULLIF(trim(j->>'name'), ''),
    COALESCE(trim(j->>'description'), ''),
    NULL,
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION public.update_worker_jobs(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.update_worker_jobs(JSONB) TO authenticated;
