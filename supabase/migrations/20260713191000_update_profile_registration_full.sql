-- Fix: guardar ubicación/detalles sin chocar con RLS.
-- 1) Política UPDATE del propio perfil
-- 2) RPC única SECURITY DEFINER con dirección + detalles + fecha nac.

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid ())
WITH CHECK (id = auth.uid ());

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS detalles_ubicacion TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE;

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
  WHERE
    id = auth.uid ();

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

-- Mantener también update_profile_extras (por si la app vieja la llama).
CREATE OR REPLACE FUNCTION public.update_profile_extras (
  p_birth_date TEXT DEFAULT NULL,
  p_detalles_ubicacion TEXT DEFAULT NULL,
  p_touch_birth_date BOOLEAN DEFAULT FALSE,
  p_touch_detalles BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    birth_date = CASE
      WHEN p_touch_birth_date THEN NULLIF(trim(COALESCE(p_birth_date, '')), '')::date
      ELSE birth_date
    END,
    detalles_ubicacion = CASE
      WHEN p_touch_detalles THEN NULLIF(trim(COALESCE(p_detalles_ubicacion, '')), '')
      ELSE detalles_ubicacion
    END,
    updated_at = now()
  WHERE
    id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.update_profile_extras (TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
