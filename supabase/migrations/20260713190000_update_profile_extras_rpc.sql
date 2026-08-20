-- Extras de perfil (fecha nac. + detalles domicilio) vía SECURITY DEFINER,
-- para no depender de UPDATE directo en RLS del cliente.

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

-- Asegurar UPDATE propio (si se perdió en algún deploy).
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid ())
WITH CHECK (id = auth.uid ());
