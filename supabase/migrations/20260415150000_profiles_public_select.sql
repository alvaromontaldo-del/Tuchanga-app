-- Permitir feed público con join a profiles (solo campos públicos).
-- Sin esto, el invite/anon no puede leer profiles y el feed cae a mocks.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Permitir SELECT público sobre filas (RLS).
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
CREATE POLICY "profiles_select_public"
ON public.profiles
FOR SELECT
TO anon
USING (TRUE);

-- Restringir columnas sensibles para anon:
-- Dejamos solo id/nombre/avatar_url accesibles.
REVOKE ALL ON TABLE public.profiles FROM anon;
GRANT SELECT (id, nombre, avatar_url) ON TABLE public.profiles TO anon;

