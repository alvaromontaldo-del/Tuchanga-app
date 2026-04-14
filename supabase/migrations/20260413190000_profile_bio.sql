-- Perfil: texto libre "bio" (presentación pública / sobre mí).
-- Ejecutá este archivo en Supabase → SQL → New query → Run (o `supabase db push`).

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.profiles.bio IS 'Presentación del usuario (opcional en UI; vacío = cadena vacía).';

-- Reemplazar RPC de registro: un parámetro más al final (p_bio).
DROP FUNCTION IF EXISTS public.insert_profile_with_location (
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT,
  INTEGER
);

CREATE OR REPLACE FUNCTION public.insert_profile_with_location (
  p_nombre TEXT,
  p_apellido TEXT,
  p_dni TEXT,
  p_telefono TEXT,
  p_direccion TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_avatar_url TEXT,
  p_coverage_km INTEGER,
  p_bio TEXT DEFAULT ''
) RETURNS VOID AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.profiles (
    id,
    nombre,
    apellido,
    dni,
    telefono,
    direccion_texto,
    location,
    avatar_url,
    coverage_km,
    bio
  )
  VALUES (
    auth.uid (),
    p_nombre,
    p_apellido,
    p_dni,
    p_telefono,
    p_direccion,
    ST_SetSRID (ST_MakePoint (p_lng, p_lat), 4326)::geography,
    NULLIF (trim(p_avatar_url), ''),
    p_coverage_km,
    COALESCE(NULLIF(trim(p_bio), ''), '')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.insert_profile_with_location (
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT,
  INTEGER,
  TEXT
) TO authenticated;
