-- YaChanga — card #1. Aceptación de términos y condiciones.
--
-- Idempotente. No modifica insert_profile_with_location.
-- La definición en producción (2026-10-01) sigue igual: valida documento
-- (dni/cuit), exige sesión y hace ON CONFLICT (id) DO UPDATE del perfil.
-- Este archivo no la reemplaza. La app llama accept_terms después del alta.
--
-- No ejecutar desde el agente: lo corre quien revisa, en el SQL editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'Cuándo auth.uid() aceptó la versión de términos guardada en terms_version.';
COMMENT ON COLUMN public.profiles.terms_version IS
  'Versión de términos aceptada (por ejemplo 2026-10-01).';
COMMENT ON COLUMN public.stores.terms_accepted_at IS
  'Cuándo el titular aceptó los términos vigentes para este comercio.';
COMMENT ON COLUMN public.stores.terms_version IS
  'Versión de términos registrada en el comercio.';

-- Lectura del propio perfil aunque el SELECT de tabla esté recortado por columna.
GRANT SELECT (terms_accepted_at, terms_version) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_terms(p_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version text := nullif(btrim(coalesce(p_version, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'terms_version_required';
  END IF;

  UPDATE public.profiles
  SET
    terms_accepted_at = now(),
    terms_version = v_version
  WHERE id = v_uid;

  UPDATE public.stores
  SET
    terms_accepted_at = now(),
    terms_version = v_version
  WHERE user_id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.accept_terms(text) IS
  'Registra la versión de términos para auth.uid() en profiles y en sus stores. No acepta otro usuario.';

REVOKE ALL ON FUNCTION public.accept_terms(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_terms(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_terms(text) TO authenticated;
