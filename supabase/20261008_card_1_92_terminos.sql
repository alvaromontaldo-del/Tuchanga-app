-- =============================================================================
-- Cards #1 y #92 — Aceptación de Términos y condiciones
-- Proyecto Supabase: TuChangaAPP (kyxehrxcdealbujvvnxp)
--
-- NO APLICADO en producción. Queda para correrlo a mano antes de Testing.
-- Idempotente. No toca insert_profile_with_location ni ninguna función viva.
--
-- La constancia va en public.terms_acceptances (una fila por usuario), no en
-- profiles ni stores: esas tablas se pueden leer de otras cuentas (perfil de
-- trabajador, comercio activo). Acá cada uno solo ve y escribe la suya.
-- anon no tiene privilegios sobre la tabla ni EXECUTE en accept_terms.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_acceptances_version_len
    CHECK (char_length(btrim(terms_version)) BETWEEN 1 AND 32)
);

COMMENT ON TABLE public.terms_acceptances IS
  'Constancia de la versión de términos que aceptó auth.uid(). Una fila por usuario.';
COMMENT ON COLUMN public.terms_acceptances.terms_version IS
  'Versión aceptada (por ejemplo 2026-10-01).';
COMMENT ON COLUMN public.terms_acceptances.accepted_at IS
  'Cuándo esa cuenta aceptó la versión guardada.';

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terms_acceptances_select_own ON public.terms_acceptances;
CREATE POLICY terms_acceptances_select_own
  ON public.terms_acceptances
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS terms_acceptances_insert_own ON public.terms_acceptances;
CREATE POLICY terms_acceptances_insert_own
  ON public.terms_acceptances
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS terms_acceptances_update_own ON public.terms_acceptances;
CREATE POLICY terms_acceptances_update_own
  ON public.terms_acceptances
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.terms_acceptances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.terms_acceptances TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_terms(p_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version text := nullif(btrim(coalesce(p_version, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_version IS NULL OR char_length(v_version) > 32 THEN
    RAISE EXCEPTION 'terms_version_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.terms_acceptances (user_id, terms_version, accepted_at)
  VALUES (v_uid, v_version, now())
  ON CONFLICT (user_id) DO UPDATE
    SET terms_version = EXCLUDED.terms_version,
        accepted_at = EXCLUDED.accepted_at;
END;
$$;

COMMENT ON FUNCTION public.accept_terms(text) IS
  'Registra la versión de términos de auth.uid(). No acepta otro usuario.';

REVOKE ALL ON FUNCTION public.accept_terms(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_terms(text) TO authenticated;
