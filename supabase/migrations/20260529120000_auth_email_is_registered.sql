-- Comprueba si un email ya está registrado en auth.users (recuperación de contraseña).
-- SECURITY DEFINER: auth.users no es legible desde el cliente; solo devuelve boolean.

CREATE OR REPLACE FUNCTION public.auth_email_is_registered(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE lower(trim(u.email)) = lower(trim(p_email))
      AND u.deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.auth_email_is_registered(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_email_is_registered(text) TO anon, authenticated;
