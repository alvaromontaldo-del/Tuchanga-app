-- =============================================================================
-- Limpieza: fotos > 500 KiB — URLs en DB + borrado real en Storage
-- =============================================================================
-- En Supabase alojado NO se puede hacer DELETE directo en storage.objects:
--   ERROR: Direct deletion from storage tables is not allowed (storage.protect_delete)
-- Por eso este archivo hace en SQL solo la limpieza de arrays en public.*.
-- Los archivos del bucket hay que borrarlos con la Storage API (script .ps1
-- en esta misma carpeta, o el Dashboard).
--
-- Orden recomendado:
--   1) Bloque "1" (solo lectura) — revisar
--   2) Bloque "2" (COMMIT) — quita URLs de posts/jobs que apuntan a esos paths
--   3) delete-heavy-job-photos.ps1 — borra los objetos en el bucket por API
--      (usa la misma query del bloque 3 para generar paths.txt)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) SOLO LECTURA — qué se va a tratar (cantidad y bytes)
-- -----------------------------------------------------------------------------
SELECT
  count(*) AS objetos_grandes,
  coalesce(sum(coalesce(nullif(metadata ->> 'size', '')::bigint, 0)), 0) AS bytes_totales
FROM storage.objects
WHERE bucket_id = 'job-photos'
  AND coalesce(nullif(metadata ->> 'size', '')::bigint, 0) > (500 * 1024);

SELECT
  id,
  name AS path_en_bucket,
  coalesce(nullif(metadata ->> 'size', '')::bigint, 0) AS size_bytes,
  metadata ->> 'mimetype' AS mimetype
FROM storage.objects
WHERE bucket_id = 'job-photos'
  AND coalesce(nullif(metadata ->> 'size', '')::bigint, 0) > (500 * 1024)
ORDER BY coalesce(nullif(metadata ->> 'size', '')::bigint, 0) DESC
LIMIT 200;


-- -----------------------------------------------------------------------------
-- 2) APLICAR — solo limpieza de URLs en public.posts y public.jobs
--    (no borra filas en storage.objects; eso lo hace el script PowerShell)
-- -----------------------------------------------------------------------------
BEGIN;

WITH heavy AS (
  SELECT name
  FROM storage.objects
  WHERE bucket_id = 'job-photos'
    AND coalesce(nullif(metadata ->> 'size', '')::bigint, 0) > (500 * 1024)
),
_posts AS (
  UPDATE public.posts p
  SET image_urls = coalesce(
    (
      SELECT array_agg(u)
      FROM unnest(coalesce(p.image_urls, '{}'::text[])) AS t(u)
      WHERE NOT EXISTS (
        SELECT 1
        FROM heavy h
        WHERE strpos(
          t.u,
          '/storage/v1/object/public/job-photos/' || h.name
        ) > 0
      )
    ),
    '{}'::text[]
  )
  WHERE EXISTS (
    SELECT 1
    FROM unnest(coalesce(p.image_urls, '{}'::text[])) AS u(url)
    JOIN heavy h ON strpos(
      u.url,
      '/storage/v1/object/public/job-photos/' || h.name
    ) > 0
  )
  RETURNING p.id
),
_jobs AS (
  UPDATE public.jobs j
  SET photo_urls = coalesce(
    (
      SELECT array_agg(u)
      FROM unnest(coalesce(j.photo_urls, '{}'::text[])) AS t(u)
      WHERE NOT EXISTS (
        SELECT 1
        FROM heavy h
        WHERE strpos(
          t.u,
          '/storage/v1/object/public/job-photos/' || h.name
        ) > 0
      )
    ),
    '{}'::text[]
  )
  WHERE EXISTS (
    SELECT 1
    FROM unnest(coalesce(j.photo_urls, '{}'::text[])) AS u(url)
    JOIN heavy h ON strpos(
      u.url,
      '/storage/v1/object/public/job-photos/' || h.name
    ) > 0
  )
  RETURNING j.id
)
SELECT
  (SELECT count(*) FROM heavy) AS paths_en_storage_marcados,
  (SELECT count(*) FROM _posts) AS posts_filas_actualizadas,
  (SELECT count(*) FROM _jobs) AS jobs_filas_actualizadas;

COMMIT;


-- -----------------------------------------------------------------------------
-- 3) Exportar paths (una fila = un path) para el .ps1 — Run, luego CSV/download
--     o copiá la columna name a paths.txt
-- -----------------------------------------------------------------------------
SELECT name
FROM storage.objects
WHERE bucket_id = 'job-photos'
  AND coalesce(nullif(metadata ->> 'size', '')::bigint, 0) > (500 * 1024)
ORDER BY name;
