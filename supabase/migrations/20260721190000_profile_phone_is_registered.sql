-- ¿Este celular ya está registrado? (anon / authenticated, solo boolean).
-- Compara dígitos normalizados (sin + / espacios); para AR también ignora prefijo 54.

CREATE OR REPLACE FUNCTION public.profile_phone_is_registered(p_phone text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH wanted AS (
    SELECT NULLIF(
      regexp_replace(
        regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'),
        '^54',
        ''
      ),
      ''
    ) AS digits
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    CROSS JOIN wanted w
    WHERE w.digits IS NOT NULL
      AND length(w.digits) >= 8
      AND regexp_replace(
            regexp_replace(COALESCE(p.telefono, ''), '[^0-9]', '', 'g'),
            '^54',
            ''
          ) = w.digits
  );
$$;

REVOKE ALL ON FUNCTION public.profile_phone_is_registered(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_phone_is_registered(text) TO anon, authenticated;

COMMENT ON FUNCTION public.profile_phone_is_registered(text) IS
  'True si ya hay un perfil con el mismo celular (dígitos, sin +54).';
