-- Sincroniza profiles.telefono → auth.users.phone (columna Phone del dashboard).
-- El cliente no puede confiar en auth.updateUser({ phone }): falla si Phone Auth/SMS
-- no está habilitado. Este SECURITY DEFINER escribe directo en auth.users.

CREATE OR REPLACE FUNCTION public.normalize_ar_phone_e164(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(d) < 8 THEN NULL
    WHEN d LIKE '54%' THEN '+' || d
    ELSE '+54' || ltrim(d, '0')
  END
  FROM (
    SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS d
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.sync_auth_phone_from_profile(p_user_id uuid, p_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e164 text := public.normalize_ar_phone_e164(p_phone);
BEGIN
  IF p_user_id IS NULL OR v_e164 IS NULL THEN
    RETURN;
  END IF;

  -- Si otro usuario ya tiene ese phone en Auth, no pisamos (unique).
  IF EXISTS (
    SELECT 1 FROM auth.users o
    WHERE o.phone = v_e164 AND o.id <> p_user_id
  ) THEN
    UPDATE auth.users u
    SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('phone', v_e164)
    WHERE u.id = p_user_id;
    RETURN;
  END IF;

  UPDATE auth.users u
  SET
    phone = v_e164,
    phone_confirmed_at = COALESCE(u.phone_confirmed_at, now()),
    raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('phone', v_e164),
    updated_at = now()
  WHERE u.id = p_user_id
    AND (u.phone IS DISTINCT FROM v_e164 OR u.phone_confirmed_at IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_auth_phone_from_profile(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_auth_phone_from_profile(uuid, text) TO service_role;

-- RPC para el usuario autenticado (app).
CREATE OR REPLACE FUNCTION public.sync_my_auth_phone(p_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  PERFORM public.sync_auth_phone_from_profile(auth.uid(), p_phone);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_my_auth_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_my_auth_phone(text) TO authenticated;

-- Cada vez que se guarda telefono en profiles, copiar a Auth.
CREATE OR REPLACE FUNCTION public.trg_profiles_sync_auth_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.telefono IS NOT NULL AND length(trim(NEW.telefono)) > 0 THEN
    IF TG_OP = 'INSERT'
      OR NEW.telefono IS DISTINCT FROM OLD.telefono THEN
      PERFORM public.sync_auth_phone_from_profile(NEW.id, NEW.telefono);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_sync_auth_phone ON public.profiles;
CREATE TRIGGER trg_profiles_sync_auth_phone
AFTER INSERT OR UPDATE OF telefono ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_profiles_sync_auth_phone();

-- Backfill: perfiles con celular → Auth Phone vacío.
SELECT public.sync_auth_phone_from_profile(p.id, p.telefono)
FROM public.profiles p
WHERE NULLIF(trim(COALESCE(p.telefono, '')), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p.id
      AND (u.phone IS NULL OR length(trim(u.phone)) = 0)
  );
