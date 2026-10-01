-- Tarjeta #18 — video de presentación del profesional.
-- Idempotente. NO ejecutar desde la app: aplicarlo a mano en prod.
--
-- Snapshot de prod (proyecto kyxehrxcdealbujvvnxp, 2026-10-01), solo lectura.
-- Los archivos del repo pueden estar viejos. Este script NO reemplaza funciones
-- que ya existen, para no pisar la #45 (apellido y lat/lng en la búsqueda anónima).
--
-- En prod HOY (antes de aplicar este archivo):
--   search_workers_for_client(double precision, double precision, text, text[], uuid, integer)
--     sigue devolviendo apellido, lat y lng. NO se toca.
--   fetch_worker_trades(uuid) y fetch_worker_posts(uuid, integer) no llevan datos de perfil.
--   No existe un RPC de "detalle del profesional". La ficha pública lee `profiles`
--     con un SELECT aparte de intro_video_path (si la columna no está, la app ignora el error).
--   set_my_avatar_url(text) queda igual. El video usa una función nueva.
--
-- Patrón de avatars: bucket público, carpeta = auth.uid(), URL pública.
-- La columna guarda el path (uid/intro-<epoch>.mp4|mov), no una URL externa.
-- anon NO recibe GRANT sobre la columna ni sobre la función (la ficha pide sesión).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS intro_video_path text;

COMMENT ON COLUMN public.profiles.intro_video_path IS
  'Path en bucket worker_videos (auth.uid()/intro-<epoch>.mp4|mov). NULL = sin video.';

REVOKE ALL (intro_video_path) ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (intro_video_path) ON public.profiles TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'worker_videos',
  'worker_videos',
  TRUE,
  31457280,
  ARRAY['video/mp4', 'video/quicktime']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "worker_videos_select_public" ON storage.objects;
DROP POLICY IF EXISTS "worker_videos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "worker_videos_update_own" ON storage.objects;
DROP POLICY IF EXISTS "worker_videos_delete_own" ON storage.objects;

CREATE POLICY "worker_videos_select_public" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'worker_videos');

CREATE POLICY "worker_videos_insert_own" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'worker_videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND name ~ ('^' || auth.uid()::text || '/intro-[0-9]+\.(mp4|mov)$')
);

CREATE POLICY "worker_videos_update_own" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'worker_videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'worker_videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND name ~ ('^' || auth.uid()::text || '/intro-[0-9]+\.(mp4|mov)$')
);

CREATE POLICY "worker_videos_delete_own" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'worker_videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE OR REPLACE FUNCTION public.set_my_intro_video_path(p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_path text := NULLIF(trim(COALESCE(p_path, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_path IS NOT NULL AND v_path !~ ('^' || v_uid::text || '/intro-[0-9]+\.(mp4|mov)$') THEN
    RAISE EXCEPTION 'invalid intro video path';
  END IF;

  UPDATE public.profiles
  SET
    intro_video_path = v_path,
    updated_at = now()
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_intro_video_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_intro_video_path(text) TO authenticated;
