-- Políticas RLS para que el panel admin (profiles.role = 'admin')
-- pueda gestionar comercios, rubros y vínculos.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- stores: admin ve y gestiona todos
DROP POLICY IF EXISTS stores_select_admin ON public.stores;
CREATE POLICY stores_select_admin ON public.stores
FOR SELECT TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS stores_insert_admin ON public.stores;
CREATE POLICY stores_insert_admin ON public.stores
FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS stores_update_admin ON public.stores;
CREATE POLICY stores_update_admin ON public.stores
FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS stores_delete_admin ON public.stores;
CREATE POLICY stores_delete_admin ON public.stores
FOR DELETE TO authenticated
USING (public.is_admin());

-- store_rubros: admin
DROP POLICY IF EXISTS store_rubros_select_admin ON public.store_rubros;
CREATE POLICY store_rubros_select_admin ON public.store_rubros
FOR SELECT TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS store_rubros_insert_admin ON public.store_rubros;
CREATE POLICY store_rubros_insert_admin ON public.store_rubros
FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS store_rubros_delete_admin ON public.store_rubros;
CREATE POLICY store_rubros_delete_admin ON public.store_rubros
FOR DELETE TO authenticated
USING (public.is_admin());

-- rubros: admin puede escribir (seed/edición)
DROP POLICY IF EXISTS rubros_insert_admin ON public.rubros;
CREATE POLICY rubros_insert_admin ON public.rubros
FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS rubros_update_admin ON public.rubros;
CREATE POLICY rubros_update_admin ON public.rubros
FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
