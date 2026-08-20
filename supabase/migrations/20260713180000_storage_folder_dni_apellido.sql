-- Carpeta de Storage: permitir {dni}_{apellido} además del UUID (auth.uid).
-- La app sube a `{dni}_{apellido}/...`; las políticas anteriores solo aceptaban el UUID.

CREATE OR REPLACE FUNCTION public.storage_owner_folder_for_me()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT NULLIF(
        regexp_replace(COALESCE(dni, ''), '[^0-9]', '', 'g')
        || '_'
        || regexp_replace(
             lower(
               translate(
                 COALESCE(apellido, ''),
                 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'
               )
             ),
             '[^a-z0-9]',
             '',
             'g'
           ),
        '_'
      )
      FROM public.profiles
      WHERE id = auth.uid()
    ),
    auth.uid()::text
  );
$$;

REVOKE ALL ON FUNCTION public.storage_owner_folder_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_owner_folder_for_me() TO authenticated;

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "job_photos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "job_photos_update_own" ON storage.objects;

CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
);

CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
);

CREATE POLICY "job_photos_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'job-photos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
);

CREATE POLICY "job_photos_update_own" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'job-photos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
)
WITH CHECK (
  bucket_id = 'job-photos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
);
