-- DNI único + chequeo público antes del registro.
-- Email ya es único en auth.users; esta migración cubre profiles.dni.

-- Normalizar DNI a solo dígitos (best-effort).
UPDATE public.profiles
SET dni = regexp_replace(COALESCE(dni, ''), '[^0-9]', '', 'g')
WHERE dni IS NOT NULL
  AND dni ~ '[^0-9]';

-- Si hay DNIs duplicados, el índice UNIQUE fallará: resolvé a mano antes (Table Editor).
-- Ver duplicados:
--   SELECT dni, count(*) FROM public.profiles GROUP BY dni HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_dni_unique
  ON public.profiles (dni)
  WHERE length(trim(COALESCE(dni, ''))) > 0;

COMMENT ON INDEX public.profiles_dni_unique IS
  'Un DNI no puede usarse en dos perfiles.';

-- ¿Este DNI ya está registrado? (anon / authenticated, solo boolean).
CREATE OR REPLACE FUNCTION public.profile_dni_is_registered(p_dni text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE regexp_replace(COALESCE(p.dni, ''), '[^0-9]', '', 'g')
      = regexp_replace(COALESCE(p_dni, ''), '[^0-9]', '', 'g')
      AND length(regexp_replace(COALESCE(p_dni, ''), '[^0-9]', '', 'g')) >= 7
  );
$$;

REVOKE ALL ON FUNCTION public.profile_dni_is_registered(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_dni_is_registered(text) TO anon, authenticated;
