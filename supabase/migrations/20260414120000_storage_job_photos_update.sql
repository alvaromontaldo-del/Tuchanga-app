-- Permitir sobrescribir fotos de oficios (la app usa storage.upload con upsert: true).
-- Sin esta política, el segundo upload al mismo path puede fallar por falta de permiso UPDATE.

DROP POLICY IF EXISTS "job_photos_update_own" ON storage.objects;

CREATE POLICY "job_photos_update_own" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'job-photos'
  AND (storage.foldername (name)) [1] = auth.uid ()::text
);
