-- Reparar RLS de Storage (avatars + job-photos) + UPDATE de profiles.
-- El error "new row violates row-level security policy" al guardar suele ser un INSERT en storage.objects.

-- Profiles UPDATE
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid ())
WITH CHECK (id = auth.uid ());

-- Storage avatars
DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_select_public" ON storage.objects;

CREATE POLICY "avatars_select_public" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'avatars');

CREATE POLICY "avatars_insert_own" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "avatars_update_own" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Storage job-photos
DROP POLICY IF EXISTS "job_photos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "job_photos_update_own" ON storage.objects;
DROP POLICY IF EXISTS "job_photos_select_public" ON storage.objects;

CREATE POLICY "job_photos_select_public" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'job-photos');

CREATE POLICY "job_photos_insert_own" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'job-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "job_photos_update_own" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'job-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'job-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RPC full (por si no se ejecutó antes)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS detalles_ubicacion TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_date DATE;

CREATE OR REPLACE FUNCTION public.update_profile_registration_full (
  p_nombre TEXT,
  p_apellido TEXT,
  p_dni TEXT,
  p_telefono TEXT,
  p_direccion TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_avatar_url TEXT,
  p_detalles_ubicacion TEXT DEFAULT NULL,
  p_birth_date TEXT DEFAULT NULL,
  p_touch_detalles BOOLEAN DEFAULT FALSE,
  p_touch_birth_date BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    nombre = trim(p_nombre),
    apellido = trim(p_apellido),
    dni = trim(p_dni),
    telefono = trim(p_telefono),
    direccion_texto = trim(p_direccion),
    location = ST_SetSRID (ST_MakePoint (p_lng, p_lat), 4326)::geography,
    avatar_url = NULLIF(trim(p_avatar_url), ''),
    detalles_ubicacion = CASE
      WHEN p_touch_detalles THEN NULLIF(trim(COALESCE(p_detalles_ubicacion, '')), '')
      ELSE detalles_ubicacion
    END,
    birth_date = CASE
      WHEN p_touch_birth_date THEN NULLIF(trim(COALESCE(p_birth_date, '')), '')::date
      ELSE birth_date
    END,
    updated_at = now()
  WHERE id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.update_profile_registration_full (
  TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT,
  TEXT, TEXT, BOOLEAN, BOOLEAN
) TO authenticated;
