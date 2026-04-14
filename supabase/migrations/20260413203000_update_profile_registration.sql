-- Edición de datos de registro (perfil autenticado).
-- Versión con bio (requiere columna `bio` en profiles).
CREATE OR REPLACE FUNCTION public.update_profile_registration (
  p_nombre TEXT,
  p_apellido TEXT,
  p_dni TEXT,
  p_telefono TEXT,
  p_direccion TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_avatar_url TEXT,
  p_bio TEXT DEFAULT ''
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
    bio = COALESCE(NULLIF(trim(p_bio), ''), ''),
    updated_at = now()
  WHERE
    id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.update_profile_registration (
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT,
  TEXT
) TO authenticated;

-- Misma lógica sin tocar `bio` (BD sin migración de bio o errores de columna).
CREATE OR REPLACE FUNCTION public.update_profile_registration_no_bio (
  p_nombre TEXT,
  p_apellido TEXT,
  p_dni TEXT,
  p_telefono TEXT,
  p_direccion TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_avatar_url TEXT
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
    updated_at = now()
  WHERE
    id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.update_profile_registration_no_bio (
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT
) TO authenticated;
