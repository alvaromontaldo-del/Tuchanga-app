-- Card #67. Aplicado en producción el 2026-10-01, antes del OTA de la app.
-- Es idempotente: se puede volver a correr en el SQL editor de Supabase.
--
-- Moderación relajada (no vuelve el filtro de la card #85):
--   bloquea teléfonos reales y emails;
--   deja pasar cinta, cable, calor, importes, fechas y palabras sueltas
--   (mail, whatsapp, calle, meta, llamar).
-- El mismo criterio aplica al texto de mensajes text, image (epígrafe),
-- budget y quotation. Los type=system solo los crean funciones
-- SECURITY DEFINER o service_role (pago, PIN, reclamo, conformidad).
--
-- El bucket `chat` queda privado. Las fotos nuevas se sirven con URL firmada.
-- cleanup_chat_images sigue encontrando el path, también el de las fotos
-- viejas que están en job-photos.

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

CREATE OR REPLACE FUNCTION public.contact_info_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  t TEXT;
  token TEXT;
  digits TEXT;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' THEN
    RETURN NULL;
  END IF;

  IF t ~ '[a-z0-9._%+\-]+@[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}' THEN
    RETURN 'email';
  END IF;

  t := regexp_replace(t, '[$] *[0-9]{1,3}(?:[. ][0-9]{3})+(?:[.,][0-9]{1,2})?', ' ', 'g');
  t := regexp_replace(t, '[$] *[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?', ' ', 'g');
  t := regexp_replace(t, '[$] *[0-9]+(?:[.,][0-9]{1,2})?', ' ', 'g');

  IF EXISTS (
    SELECT 1
    FROM regexp_matches(t, '(^|[^0-9])([0-9]{8,15})([^0-9]|$)', 'g') AS m
  ) THEN
    RETURN 'telefono_num';
  END IF;

  FOR token IN
    SELECT x[1]
    FROM regexp_matches(
      t,
      '((?:\+ *)?(?:\([0-9]{1,4}\) *|[0-9]{1,4}[ -]+){1,6}[0-9]{2,4})',
      'g'
    ) AS x
  LOOP
    digits := regexp_replace(token, '[^0-9]', '', 'g');
    IF length(digits) BETWEEN 8 AND 15 THEN
      RETURN 'telefono_num';
    END IF;
  END LOOP;

  FOR token IN
    SELECT x[2]
    FROM regexp_matches(
      t,
      '(^|[^0-9])([0-9]{1,4}(?:\.[0-9]{2,4}){1,4})([^0-9]|$)',
      'g'
    ) AS x
  LOOP
    IF token ~ '^[0-9]{1,3}(?:\.[0-9]{3})+$' THEN
      CONTINUE;
    END IF;
    digits := regexp_replace(token, '[^0-9]', '', 'g');
    IF length(digits) BETWEEN 8 AND 15 THEN
      RETURN 'telefono_num';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.contact_info_blocked_reason(TEXT) IS
  'Filtro relajado: email o teléfono real. No bloquea cinta, cable, calor ni importes.';

CREATE OR REPLACE FUNCTION public.message_body_blocked_reason(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT public.contact_info_blocked_reason(p_text);
$$;

CREATE OR REPLACE FUNCTION public.message_free_text_blocked_reason(
  p_type text,
  p_body text,
  p_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  reason text;
  key text;
  val jsonb;
  elem jsonb;
  nested_key text;
  keys text[] := ARRAY[
    'service_detail', 'description', 'caption', 'notes', 'note',
    'detail', 'comment', 'label', 'title', 'text', 'message'
  ];
BEGIN
  IF coalesce(p_type, 'text') = 'system' THEN
    RETURN NULL;
  END IF;

  reason := public.contact_info_blocked_reason(p_body);
  IF reason IS NOT NULL THEN
    RETURN reason;
  END IF;

  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RETURN NULL;
  END IF;

  FOREACH key IN ARRAY keys LOOP
    val := p_metadata -> key;
    IF val IS NULL THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(val) = 'string' THEN
      reason := public.contact_info_blocked_reason(val #>> '{}');
      IF reason IS NOT NULL THEN
        RETURN reason;
      END IF;
    ELSIF jsonb_typeof(val) = 'array' THEN
      FOR elem IN SELECT value FROM jsonb_array_elements(val) LOOP
        IF jsonb_typeof(elem) = 'string' THEN
          reason := public.contact_info_blocked_reason(elem #>> '{}');
          IF reason IS NOT NULL THEN
            RETURN reason;
          END IF;
        ELSIF jsonb_typeof(elem) = 'object' THEN
          FOREACH nested_key IN ARRAY keys LOOP
            IF jsonb_typeof(elem -> nested_key) = 'string' THEN
              reason := public.contact_info_blocked_reason(elem ->> nested_key);
              IF reason IS NOT NULL THEN
                RETURN reason;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.contact_info_blocked_reason(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_info_blocked_reason(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.contact_info_blocked_reason(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.message_body_blocked_reason(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_body_blocked_reason(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.message_body_blocked_reason(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.message_free_text_blocked_reason(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_free_text_blocked_reason(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.message_free_text_blocked_reason(text, text, jsonb) FROM authenticated;

-- El trigger de reglas es SECURITY DEFINER: adentro, current_user es el
-- dueño y no distingue al cliente. Este trigger es INVOKER, así que ve
-- el rol que ejecuta el INSERT (authenticated en el cliente; el dueño
-- cuando el INSERT sale de una función SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.reject_client_system_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.type, 'text') = 'system'
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'system_message_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_reject_client_system ON public.messages;
CREATE TRIGGER trg_messages_reject_client_system
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_client_system_message();

CREATE OR REPLACE FUNCTION public.enforce_message_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
  blocked_pair BOOLEAN;
  image_url TEXT;
  image_path TEXT;
  image_bucket TEXT;
  block_reason TEXT;
BEGIN
  IF coalesce(NEW.type, 'text') = 'system' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND (
          c.cliente_id = NEW.sender_id
          OR c.trabajador_id = NEW.sender_id
        )
    ) THEN
      RAISE EXCEPTION 'system_sender_not_participant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF public.chat_cerrado_por_reclamo_conformidad(NEW.conversation_id) THEN
    RAISE EXCEPTION 'chat_cerrado_por_reclamo' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'sender_mismatch' USING ERRCODE = '42501';
  END IF;

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

  SELECT COUNT(*)::int INTO recent_count
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '1 minute';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  block_reason := public.message_free_text_blocked_reason(
    NEW.type,
    NEW.body,
    coalesce(NEW.metadata, '{}'::jsonb)
  );
  IF block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'message_blocked_contact' USING ERRCODE = 'P0001';
  END IF;

  IF char_length(coalesce(NEW.body, '')) > 2000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(NEW.type, 'text') = 'image' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND c.cliente_id = NEW.sender_id
    ) THEN
      RAISE EXCEPTION 'image_client_only' USING ERRCODE = 'P0001';
    END IF;

    image_path := nullif(trim(coalesce(NEW.metadata->>'image_path', '')), '');
    image_bucket := nullif(trim(coalesce(NEW.metadata->>'image_bucket', '')), '');
    image_url := nullif(trim(coalesce(NEW.metadata->>'image_url', '')), '');

    IF image_path IS NOT NULL THEN
      IF coalesce(image_bucket, 'chat') <> 'chat'
         OR image_path ~ '(^|/)\.\.(/|$)'
         OR left(image_path, 1) = '/'
         OR image_path !~ '^[^/]+/chat/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$'
      THEN
        RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
      END IF;
    ELSIF image_url IS NULL OR image_url !~* '^https?://' THEN
      RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_enforce_rules ON public.messages;
CREATE TRIGGER trg_messages_enforce_rules
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_rules();

DROP POLICY IF EXISTS "msg_insert_participant" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_as_participant" ON public.messages;
CREATE POLICY "msg_insert_participant" ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND coalesce(type, 'text') IS DISTINCT FROM 'system'
  AND EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = conversation_id
      AND (
        c.cliente_id = auth.uid()
        OR c.trabajador_id = auth.uid()
      )
  )
);

-- ---------------------------------------------------------------------------
-- Paths de fotos (públicas viejas, firmadas y bucket chat)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.chat_image_storage_path(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u text := regexp_replace(trim(coalesce(p_url, '')), '[?#].*$', '');
  markers text[] := ARRAY[
    '/object/public/job-photos/',
    '/object/sign/job-photos/',
    '/object/authenticated/job-photos/',
    '/object/public/chat/',
    '/object/sign/chat/',
    '/object/authenticated/chat/'
  ];
  marker text;
  pos int;
BEGIN
  IF u = '' THEN
    RETURN NULL;
  END IF;
  u := replace(replace(u, '%2F', '/'), '%2f', '/');
  FOREACH marker IN ARRAY markers LOOP
    pos := strpos(u, marker);
    IF pos > 0 THEN
      RETURN nullif(substring(u from pos + length(marker)), '');
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_image_storage_bucket(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u text := regexp_replace(trim(coalesce(p_url, '')), '[?#].*$', '');
BEGIN
  IF u = '' THEN
    RETURN NULL;
  END IF;
  IF strpos(u, '/object/public/chat/') > 0
     OR strpos(u, '/object/sign/chat/') > 0
     OR strpos(u, '/object/authenticated/chat/') > 0 THEN
    RETURN 'chat';
  END IF;
  IF strpos(u, '/object/public/job-photos/') > 0
     OR strpos(u, '/object/sign/job-photos/') > 0
     OR strpos(u, '/object/authenticated/job-photos/') > 0 THEN
    RETURN 'job-photos';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_image_object_path(p_metadata jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  p text := nullif(trim(coalesce(p_metadata->>'image_path', '')), '');
BEGIN
  IF p IS NOT NULL THEN
    RETURN p;
  END IF;
  RETURN public.chat_image_storage_path(p_metadata->>'image_url');
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_image_object_bucket(p_metadata jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  b text := nullif(trim(coalesce(p_metadata->>'image_bucket', '')), '');
BEGIN
  IF b IN ('chat', 'job-photos') THEN
    RETURN b;
  END IF;
  b := public.chat_image_storage_bucket(p_metadata->>'image_url');
  IF b IS NOT NULL THEN
    RETURN b;
  END IF;
  IF nullif(trim(coalesce(p_metadata->>'image_path', '')), '') IS NOT NULL THEN
    RETURN 'chat';
  END IF;
  RETURN 'job-photos';
END;
$$;

DROP FUNCTION IF EXISTS public.archive_eligible_chats_and_list_images(integer);
DROP FUNCTION IF EXISTS public.list_expired_chat_images(integer);

CREATE OR REPLACE FUNCTION public.list_expired_chat_images(
  p_retention_days integer DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  image_url text,
  storage_path text,
  closed_at timestamptz,
  storage_bucket text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := coalesce(p_retention_days, public.chat_cleanup_retention_days());
BEGIN
  v_days := GREATEST(0, v_days);

  RETURN QUERY
  WITH ready AS (
    SELECT
      c.id AS contratacion_id,
      c.conversation_id,
      GREATEST(
        wr.created_at,
        coalesce(c.offline_pago_confirmado_at, c.paid_at, wr.created_at)
      ) AS closed_at
    FROM public.contrataciones c
    INNER JOIN public.worker_reviews wr
      ON wr.job_id = c.id
      OR wr.conversation_id = c.conversation_id
    WHERE c.estado_pago = 'totalmente_pagado'
      AND (c.offline_pago_confirmado_at IS NOT NULL OR c.paid_at IS NOT NULL)
      AND c.conversation_id IS NOT NULL
  ),
  eligible AS (
    SELECT
      r.conversation_id,
      MAX(r.closed_at) AS closed_at
    FROM ready r
    WHERE r.closed_at <= (now() - make_interval(days => v_days))
      AND NOT EXISTS (
        SELECT 1
        FROM public.contrataciones a
        WHERE a.conversation_id = r.conversation_id
          AND a.estado_trabajo NOT IN ('finalizado', 'cancelado', 'disputa')
      )
    GROUP BY r.conversation_id
  )
  SELECT
    m.id AS message_id,
    m.conversation_id,
    nullif(trim(coalesce(m.metadata->>'image_url', '')), '') AS image_url,
    public.chat_image_object_path(m.metadata) AS storage_path,
    e.closed_at,
    public.chat_image_object_bucket(m.metadata) AS storage_bucket
  FROM eligible e
  JOIN public.messages m
    ON m.conversation_id = e.conversation_id
   AND m.type = 'image';
END;
$$;

REVOKE ALL ON FUNCTION public.list_expired_chat_images(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_chat_images(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.archive_eligible_chats_and_list_images(
  p_retention_days integer DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  image_url text,
  storage_path text,
  closed_at timestamptz,
  storage_bucket text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := coalesce(p_retention_days, public.chat_cleanup_retention_days());
  r record;
BEGIN
  v_days := GREATEST(0, v_days);

  FOR r IN
    SELECT DISTINCT c.id AS contratacion_id
    FROM public.contrataciones c
    INNER JOIN public.worker_reviews wr
      ON wr.job_id = c.id
      OR wr.conversation_id = c.conversation_id
    WHERE c.estado_pago = 'totalmente_pagado'
      AND (c.offline_pago_confirmado_at IS NOT NULL OR c.paid_at IS NOT NULL)
      AND c.conversation_id IS NOT NULL
      AND GREATEST(
            wr.created_at,
            coalesce(c.offline_pago_confirmado_at, c.paid_at, wr.created_at)
          ) <= (now() - make_interval(days => v_days))
  LOOP
    PERFORM public.try_archive_chat_after_job_complete(r.contratacion_id);
  END LOOP;

  RETURN QUERY
  SELECT * FROM public.list_expired_chat_images(v_days);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_eligible_chats_and_list_images(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_eligible_chats_and_list_images(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Bucket privado de chat
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat', 'chat', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

DROP POLICY IF EXISTS "chat_images_insert_client" ON storage.objects;
CREATE POLICY "chat_images_insert_client" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat'
  AND (storage.foldername(name))[2] = 'chat'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
  AND EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[3]
      AND c.cliente_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "chat_images_select_participant" ON storage.objects;
CREATE POLICY "chat_images_select_participant" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'chat'
  AND EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id::text = (storage.foldername(name))[3]
      AND (
        c.cliente_id = auth.uid()
        OR c.trabajador_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS "chat_images_update_client" ON storage.objects;
CREATE POLICY "chat_images_update_client" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'chat'
  AND (storage.foldername(name))[2] = 'chat'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
)
WITH CHECK (
  bucket_id = 'chat'
  AND (storage.foldername(name))[2] = 'chat'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = public.storage_owner_folder_for_me()
  )
);

-- ---------------------------------------------------------------------------
-- Las RPC de limpieza son solo para service_role (edge cleanup_chat_images).
-- Supabase le da EXECUTE a anon/authenticated por default privileges al crear
-- la función, así que hay que sacarlo explícito.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.list_expired_chat_images(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_eligible_chats_and_list_images(integer) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Panel admin: puede firmar fotos del bucket privado `chat`.
-- admin_get_chat devuelve una referencia de Storage para las fotos nuevas
-- (metadata.image_path, sin URL pública). El panel la reconoce y la firma.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "chat_images_select_admin" ON storage.objects;
CREATE POLICY "chat_images_select_admin" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'chat'
  AND public.is_admin()
);

CREATE OR REPLACE FUNCTION public.admin_get_chat(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_head jsonb;
  v_messages jsonb;
BEGIN
  PERFORM public._admin_require();

  SELECT jsonb_build_object(
    'id', c.id,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'deleted_at', c.deleted_at,
    'oficio', coalesce(nullif(btrim(c.primary_trade), ''), ''),
    'client_id', c.cliente_id,
    'client_name', coalesce(public._admin_full_name(pc.nombre, pc.apellido), ''),
    'client_email', coalesce(uc.email, ''),
    'client_role', 'cliente',
    'worker_id', c.trabajador_id,
    'worker_name', coalesce(public._admin_full_name(pw.nombre, pw.apellido), ''),
    'worker_email', coalesce(uw.email, ''),
    'worker_role', 'trabajador'
  )
  INTO v_head
  FROM public.conversations c
  LEFT JOIN public.profiles pc ON pc.id = c.cliente_id
  LEFT JOIN auth.users uc ON uc.id = c.cliente_id
  LEFT JOIN public.profiles pw ON pw.id = c.trabajador_id
  LEFT JOIN auth.users uw ON uw.id = c.trabajador_id
  WHERE c.id = p_conversation_id;

  IF v_head IS NULL THEN
    RAISE EXCEPTION 'Chat no encontrado';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'sender_id', m.sender_id,
    'sender_name', coalesce(public._admin_full_name(p.nombre, p.apellido), 'Usuario'),
    'sender_role', CASE
      WHEN m.sender_id = (v_head->>'client_id')::uuid THEN 'cliente'
      WHEN m.sender_id = (v_head->>'worker_id')::uuid THEN 'trabajador'
      ELSE 'otro'
    END,
    'body', coalesce(m.body, ''),
    'image_url', coalesce(
      nullif(
        btrim(
          coalesce(
            m.metadata->>'image_url',
            m.metadata->>'url',
            m.metadata->>'path',
            m.metadata->>'storage_path',
            ''
          )
        ),
        ''
      ),
      CASE
        WHEN nullif(btrim(coalesce(m.metadata->>'image_path', '')), '') IS NOT NULL THEN
          '/storage/v1/object/authenticated/'
          || coalesce(nullif(btrim(m.metadata->>'image_bucket'), ''), 'chat')
          || '/'
          || btrim(m.metadata->>'image_path')
      END
    ),
    'created_at', m.created_at,
    'kind', coalesce(m.type, 'text')
  ) ORDER BY m.created_at ASC), '[]'::jsonb)
  INTO v_messages
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id = m.sender_id
  WHERE m.conversation_id = p_conversation_id;

  RETURN v_head || jsonb_build_object('messages', coalesce(v_messages, '[]'::jsonb));
END;
$function$;
