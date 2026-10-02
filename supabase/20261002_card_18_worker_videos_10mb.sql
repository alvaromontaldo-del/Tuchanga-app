-- Tarjeta #18 — bajar el tope del bucket worker_videos de 30 MB a 10 MB.
-- Idempotente. NO ejecutar desde la app: aplicarlo a mano en prod (kyxehrxcdealbujvvnxp).
--
-- Definición live al 2026-10-02, antes de este cambio:
--   storage.buckets.worker_videos
--     public = true
--     file_size_limit = 31457280
--     allowed_mime_types = {video/mp4, video/quicktime}
--   Políticas (no se tocan):
--     worker_videos_select_public  SELECT public
--       USING (bucket_id = 'worker_videos')
--     worker_videos_insert_own     INSERT authenticated
--       WITH CHECK (bucket propio + name ~ '^uid/intro-[0-9]+\.(mp4|mov)$')
--     worker_videos_update_own     UPDATE authenticated
--       USING/CHECK carpeta = auth.uid() y el mismo patrón de nombre
--     worker_videos_delete_own     DELETE authenticated
--       USING (bucket propio y carpeta = auth.uid())
--   public.set_my_intro_video_path(text) no cambia: no se recrea.
--
-- La app graba a 480p / 700 kbps (H.264). 30 s quedan en ~2–3 MB.
-- 10 MB es la red de seguridad para que un encoder que se pase no vuelva
-- a llenar Storage.

UPDATE storage.buckets
SET file_size_limit = 10485760
WHERE id = 'worker_videos'
  AND file_size_limit IS DISTINCT FROM 10485760;
