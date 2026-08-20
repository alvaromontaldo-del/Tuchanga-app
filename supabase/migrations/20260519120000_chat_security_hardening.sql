-- Tu Changa — endurecimiento de seguridad del chat (6 ítems)
-- 1) get_unread_counts solo conversaciones del usuario
-- 2) Moderación anti-contacto en INSERT de messages
-- 3) RLS profiles: sin SELECT global para authenticated
-- 4) (app) acceso al chat solo participantes
-- 5) Rate limit de mensajes
-- 6) Bloqueos y reportes de usuarios

-- ---------------------------------------------------------------------------
-- 1) get_unread_counts: exigir participación
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_unread_counts(
  p_conversation_ids UUID[]
) RETURNS TABLE (
  conversation_id UUID,
  unread_count INTEGER
) AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  WITH my_convs AS (
    SELECT c.id
    FROM public.conversations c
    WHERE c.id = ANY(p_conversation_ids)
      AND (c.cliente_id = uid OR c.trabajador_id = uid)
  ),
  reads AS (
    SELECT cr.conversation_id, cr.read_at
    FROM public.conversation_reads cr
    WHERE cr.user_id = uid
      AND cr.conversation_id IN (SELECT id FROM my_convs)
  )
  SELECT
    m.conversation_id,
    COUNT(*)::int AS unread_count
  FROM public.messages m
  JOIN my_convs mc ON mc.id = m.conversation_id
  LEFT JOIN reads r ON r.conversation_id = m.conversation_id
  WHERE m.sender_id <> uid
    AND m.created_at > COALESCE(r.read_at, '1970-01-01'::timestamptz)
  GROUP BY m.conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- ---------------------------------------------------------------------------
-- 2) Moderación de mensajes (servidor)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_message_body(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    trim(
      regexp_replace(
        translate(
          coalesce(p_text, ''),
          'áàäâãåéèëêíìïîóòöôõúùüûñ',
          'aaaaaaeeeeiiiiooooouuuun'
        ),
        '\s+',
        ' ',
        'g'
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.message_body_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t TEXT;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' THEN
    RETURN NULL;
  END IF;

  IF t ~ '\y(cel(ular|u)?|wsp|wp|whats(app)?|tel|telefono|telefonos|phone|contacto)\y' THEN
    RETURN 'contacto';
  END IF;
  IF t ~ '\y(instagram|insta)\y' OR t ~ '\yig\y' THEN
    RETURN 'redes';
  END IF;
  IF position('@' IN t) > 0 THEN
    RETURN 'email_red';
  END IF;
  IF t ~ '\y(direccion|address)\y' THEN
    RETURN 'direccion';
  END IF;
  IF t ~ '\ypunto\s*com\y' OR t ~ '\ypunto\s*net\y' OR t ~ '\.com\y' OR t ~ '\.net\y' THEN
    RETURN 'link';
  END IF;
  -- Teléfonos: secuencias de 8+ dígitos (con separadores opcionales)
  IF regexp_replace(t, '[^0-9]', '', 'g') ~ '[0-9]{8,}' THEN
    RETURN 'telefono_num';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_message_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  block_reason TEXT;
  recent_count INT;
  blocked_pair BOOLEAN;
BEGIN
  IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'sender_mismatch' USING ERRCODE = '42501';
  END IF;

  -- Bloqueo entre participantes del hilo
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.user_blocks b ON (
      (b.blocker_id = c.cliente_id AND b.blocked_id = c.trabajador_id)
      OR (b.blocker_id = c.trabajador_id AND b.blocked_id = c.cliente_id)
    )
    WHERE c.id = NEW.conversation_id
  ) INTO blocked_pair;

  IF blocked_pair THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: máx. 30 mensajes por minuto por usuario
  SELECT COUNT(*)::int INTO recent_count
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '1 minute';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- Presupuestos / metadatos estructurados: no moderar cuerpo vacío o tipo budget
  IF coalesce(NEW.type, 'text') <> 'text' THEN
    RETURN NEW;
  END IF;

  block_reason := public.message_body_blocked_reason(NEW.body);
  IF block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'message_blocked_contact' USING ERRCODE = 'P0001';
  END IF;

  IF char_length(coalesce(NEW.body, '')) > 2000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_enforce_rules ON public.messages;
CREATE TRIGGER trg_messages_enforce_rules
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_rules();

-- ---------------------------------------------------------------------------
-- 3) RLS profiles — quitar SELECT abierto para authenticated
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_select_auth" ON public.profiles;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_select_chat_peer" ON public.profiles;
CREATE POLICY "profiles_select_chat_peer"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE (
      c.cliente_id = auth.uid() AND c.trabajador_id = profiles.id
    ) OR (
      c.trabajador_id = auth.uid() AND c.cliente_id = profiles.id
    )
  )
);

DROP POLICY IF EXISTS "profiles_select_active_worker" ON public.profiles;
CREATE POLICY "profiles_select_active_worker"
ON public.profiles
FOR SELECT
TO authenticated
USING (coalesce(coverage_km, 0) > 0);

DROP POLICY IF EXISTS "profiles_select_service_job_peer" ON public.profiles;
CREATE POLICY "profiles_select_service_job_peer"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.service_jobs sj
    WHERE (
      sj.client_id = auth.uid() AND sj.worker_id = profiles.id
    ) OR (
      sj.worker_id = auth.uid() AND sj.client_id = profiles.id
    )
  )
);

-- ---------------------------------------------------------------------------
-- 6) Bloqueos y reportes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_distinct CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations (id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_reports_distinct CHECK (reporter_id <> reported_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON public.user_reports (reported_id, created_at DESC);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own
ON public.user_blocks
FOR SELECT
TO authenticated
USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own
ON public.user_blocks
FOR INSERT
TO authenticated
WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own
ON public.user_blocks
FOR DELETE
TO authenticated
USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS user_reports_insert_own ON public.user_reports;
CREATE POLICY user_reports_insert_own
ON public.user_reports
FOR INSERT
TO authenticated
WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS user_reports_select_own ON public.user_reports;
CREATE POLICY user_reports_select_own
ON public.user_reports
FOR SELECT
TO authenticated
USING (reporter_id = auth.uid());

-- Impedir crear conversación si hay bloqueo
CREATE OR REPLACE FUNCTION public.find_or_create_conversation(
  p_trabajador_id uuid,
  p_primary_trade text default ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid := auth.uid();
  v_id uuid;
  v_trade text;
  v_blocked boolean;
BEGIN
  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF v_cliente_id = p_trabajador_id THEN
    RAISE EXCEPTION 'invalid_peer';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks b
    WHERE (b.blocker_id = v_cliente_id AND b.blocked_id = p_trabajador_id)
       OR (b.blocker_id = p_trabajador_id AND b.blocked_id = v_cliente_id)
  ) INTO v_blocked;

  IF v_blocked THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = 'P0001';
  END IF;

  v_trade := nullif(trim(coalesce(p_primary_trade, '')), '');

  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.cliente_id = v_cliente_id
    AND c.trabajador_id = p_trabajador_id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (cliente_id, trabajador_id, primary_trade, updated_at)
  VALUES (v_cliente_id, p_trabajador_id, v_trade, now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_conversation(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, text) TO authenticated;
