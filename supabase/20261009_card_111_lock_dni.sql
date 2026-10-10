-- #111 — El DNI (o el CUIT guardado en profiles.dni) no se puede cambiar
-- una vez cargado, ni desde la app actual ni desde una app vieja que
-- llame a update_profile_registration*.
--
-- Las funciones de perfil son SECURITY DEFINER, dueño postgres, así que
-- un chequeo de current_user no ve al cliente. Este trigger mira el JWT
-- (auth.role / request.jwt.claim.role), que sigue siendo el de quien llamó:
--   * authenticated que no es admin: si ya hay 7 dígitos o más, el número
--     y document_type quedan como estaban. Si manda otro número, dni_locked.
--   * sin documento (vacío o el placeholder corto de cuentas viejas):
--     se puede cargar una sola vez.
--   * service_role, profiles.role = admin (is_admin) y postgres sin JWT
--     (SQL del dashboard) pueden corregirlo.
--
-- No se tocan las funciones vivas ni sus grants. El trigger corre igual
-- en el UPDATE de insert_profile_with_location (ON CONFLICT),
-- update_profile_registration, update_profile_registration_full,
-- update_profile_registration_no_bio y ensure_my_client_profile.
--
-- Probado con BEGIN … ROLLBACK sobre datos reales. No aplicado.

CREATE OR REPLACE FUNCTION public.profiles_lock_dni_once_set()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', ''),
    ''
  );
  v_old text := regexp_replace(coalesce(OLD.dni, ''), '[^0-9]', '', 'g');
  v_new text := regexp_replace(coalesce(NEW.dni, ''), '[^0-9]', '', 'g');
BEGIN
  IF v_jwt_role = 'service_role' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF v_jwt_role = '' AND current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF length(v_old) < 7 THEN
    RETURN NEW;
  END IF;

  IF v_new IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'dni_locked'
      USING ERRCODE = '42501',
            HINT = 'El DNI no se puede modificar una vez cargado.';
  END IF;

  NEW.dni := OLD.dni;
  NEW.document_type := OLD.document_type;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.profiles_lock_dni_once_set() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_lock_dni_once_set() TO service_role;

DROP TRIGGER IF EXISTS trg_profiles_lock_dni_once_set ON public.profiles;
CREATE TRIGGER trg_profiles_lock_dni_once_set
  BEFORE UPDATE OF dni, document_type ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_lock_dni_once_set();
