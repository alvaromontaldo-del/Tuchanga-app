-- #218 Campanita e inbox de avisos de YaChanga (primera versión).
-- Solo los ejemplos de la tarjeta: comercio aprobado/rechazado,
-- profesional aprobado, y 20 o 10 días de prueba gratis.
-- No entra el chat ni el tablero operativo de pedidos.
-- No se recrean notify_matricula_rechazo ni notify_antecedentes_rechazo.

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('cliente', 'profesional', 'comercio')),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_notifications_dedupe UNIQUE (user_id, type, dedupe_key)
);

CREATE INDEX IF NOT EXISTS app_notifications_user_created_idx
  ON public.app_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS app_notifications_user_unread_idx
  ON public.app_notifications (user_id, audience)
  WHERE read_at IS NULL;

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_notifications_select_own ON public.app_notifications;
CREATE POLICY app_notifications_select_own
  ON public.app_notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.app_notifications FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.app_notifications TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.app_notifications';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.emit_app_notification(
  p_user_id uuid,
  p_audience text,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_store_id uuid DEFAULT NULL,
  p_dedupe_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_audience text := lower(btrim(coalesce(p_audience, '')));
  v_type text := left(btrim(coalesce(p_type, '')), 64);
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_body text := left(btrim(coalesce(p_body, '')), 500);
  v_key text := left(btrim(coalesce(p_dedupe_key, '')), 240);
BEGIN
  IF p_user_id IS NULL OR v_type = '' OR v_title = '' OR v_body = '' THEN
    RETURN NULL;
  END IF;
  IF v_audience NOT IN ('cliente', 'profesional', 'comercio') THEN
    RETURN NULL;
  END IF;
  IF v_type NOT IN (
    'store_approved',
    'store_rejected',
    'store_trial_notice_10',
    'store_trial_notice_20',
    'professional_aprobado'
  ) THEN
    RETURN NULL;
  END IF;
  IF v_key = '' THEN
    v_key := gen_random_uuid()::text;
  END IF;

  INSERT INTO public.app_notifications (
    user_id, audience, type, title, body, data, store_id, dedupe_key
  )
  VALUES (
    p_user_id,
    v_audience,
    v_type,
    v_title,
    v_body,
    coalesce(p_data, '{}'::jsonb),
    p_store_id,
    v_key
  )
  ON CONFLICT (user_id, type, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT n.id INTO v_id
    FROM public.app_notifications n
    WHERE n.user_id = p_user_id
      AND n.type = v_type
      AND n.dedupe_key = v_key;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.emit_app_notification(uuid, text, text, text, text, jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.emit_app_notification(uuid, text, text, text, text, jsonb, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.emit_app_notification(uuid, text, text, text, text, jsonb, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.emit_app_notification(uuid, text, text, text, text, jsonb, uuid, text) FROM service_role;

CREATE OR REPLACE FUNCTION public._app_notification_audiences_ok(p_audiences text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw text;
  v_one text;
  v_out text[] := ARRAY[]::text[];
BEGIN
  IF p_audiences IS NULL OR coalesce(cardinality(p_audiences), 0) = 0 THEN
    RAISE EXCEPTION 'Indicá para qué perfil querés ver los avisos.';
  END IF;
  FOREACH v_raw IN ARRAY p_audiences LOOP
    v_one := lower(btrim(coalesce(v_raw, '')));
    IF v_one NOT IN ('cliente', 'profesional', 'comercio') THEN
      RAISE EXCEPTION 'El perfil de avisos no es válido.';
    END IF;
    IF NOT v_one = ANY (v_out) THEN
      v_out := v_out || v_one;
    END IF;
  END LOOP;
  IF coalesce(cardinality(v_out), 0) = 0 THEN
    RAISE EXCEPTION 'Indicá para qué perfil querés ver los avisos.';
  END IF;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public._app_notification_audiences_ok(text[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_my_app_notifications(
  p_audiences text[],
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  audience text,
  type text,
  title text,
  body text,
  data jsonb,
  store_id uuid,
  read_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_audiences text[];
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tenés que iniciar sesión.';
  END IF;
  v_audiences := public._app_notification_audiences_ok(p_audiences);

  RETURN QUERY
  SELECT
    n.id,
    n.audience,
    n.type,
    n.title,
    n.body,
    n.data,
    n.store_id,
    n.read_at,
    n.created_at
  FROM public.app_notifications n
  WHERE n.user_id = v_uid
    AND n.audience = ANY (v_audiences)
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_unread_app_notifications(p_audiences text[])
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_audiences text[];
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tenés que iniciar sesión.';
  END IF;
  v_audiences := public._app_notification_audiences_ok(p_audiences);

  SELECT count(*)::integer INTO v_count
  FROM public.app_notifications n
  WHERE n.user_id = v_uid
    AND n.audience = ANY (v_audiences)
    AND n.read_at IS NULL;

  RETURN coalesce(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_app_notification_read(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tenés que iniciar sesión.';
  END IF;
  IF p_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.app_notifications n
  SET read_at = now()
  WHERE n.id = p_id
    AND n.user_id = v_uid
    AND n.read_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_app_notifications_read(p_audiences text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_audiences text[];
  v_updated integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tenés que iniciar sesión.';
  END IF;
  v_audiences := public._app_notification_audiences_ok(p_audiences);

  UPDATE public.app_notifications n
  SET read_at = now()
  WHERE n.user_id = v_uid
    AND n.audience = ANY (v_audiences)
    AND n.read_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN coalesce(v_updated, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_my_app_notifications(text[], integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.count_unread_app_notifications(text[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.mark_app_notification_read(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.mark_all_app_notifications_read(text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_app_notifications(text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_unread_app_notifications(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_app_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_app_notifications_read(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_app_notifications_from_store_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
BEGIN
  IF NEW.event_type NOT IN (
    'store_approved',
    'store_rejected',
    'store_trial_notice_10',
    'store_trial_notice_20'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT s.user_id INTO v_user
  FROM public.stores s
  WHERE s.id = NEW.store_id;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.emit_app_notification(
    v_user,
    'comercio',
    NEW.event_type,
    NEW.title,
    NEW.body,
    coalesce(NEW.data, '{}'::jsonb),
    NEW.store_id,
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_app_notifications_from_store_push ON public.store_push_events;
CREATE TRIGGER trg_app_notifications_from_store_push
  AFTER INSERT ON public.store_push_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_app_notifications_from_store_push();

CREATE OR REPLACE FUNCTION public.trg_app_notifications_store_rejected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_body text;
  v_reason text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status IS DISTINCT FROM 'rejected' THEN
    RETURN NEW;
  END IF;

  v_reason := btrim(coalesce(NEW.rejection_reason, ''));
  v_body := 'Tu comercio no pudo ser aprobado.';
  IF v_reason <> '' THEN
    v_body := v_body || ' Motivo: ' || v_reason;
    IF right(v_body, 1) NOT IN ('.', '!', '?') THEN
      v_body := v_body || '.';
    END IF;
  END IF;

  PERFORM public.enqueue_store_push(
    NEW.id,
    'store_rejected',
    'Comercio no aprobado',
    v_body,
    jsonb_build_object(
      'kind', 'store_rejected',
      'store_id', NEW.id
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_app_notifications_store_rejected ON public.stores;
CREATE TRIGGER trg_app_notifications_store_rejected
  AFTER UPDATE OF status ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_app_notifications_store_rejected();

CREATE OR REPLACE FUNCTION public.trg_app_notifications_professional_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.professional_status IS NOT DISTINCT FROM OLD.professional_status THEN
    RETURN NEW;
  END IF;
  IF NEW.professional_status IS DISTINCT FROM 'accepted' THEN
    RETURN NEW;
  END IF;

  v_key := 'accepted:' || coalesce(NEW.professional_reviewed_at, now())::text;

  PERFORM public.emit_app_notification(
    NEW.id,
    'profesional',
    'professional_aprobado',
    'Perfil profesional aprobado',
    'Tu perfil profesional ya está visible en YaChanga. Ya podés recibir consultas.',
    jsonb_build_object('kind', 'professional_aprobado'),
    NULL,
    v_key
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_app_notifications_professional_status ON public.profiles;
CREATE TRIGGER trg_app_notifications_professional_status
  AFTER UPDATE OF professional_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_app_notifications_professional_status();

REVOKE ALL ON FUNCTION public.trg_app_notifications_from_store_push() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_app_notifications_store_rejected() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_app_notifications_professional_status() FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_anon integer;
BEGIN
  SELECT count(*)::integer INTO v_anon
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND privilege_type = 'EXECUTE'
    AND grantee IN ('anon', 'PUBLIC')
    AND routine_name IN (
      'emit_app_notification',
      '_app_notification_audiences_ok',
      'trg_app_notifications_from_store_push',
      'trg_app_notifications_store_rejected',
      'trg_app_notifications_professional_status'
    );
  IF v_anon > 0 THEN
    RAISE EXCEPTION 'No se debe dar EXECUTE a anon/PUBLIC en helpers de avisos';
  END IF;
END
$$;
