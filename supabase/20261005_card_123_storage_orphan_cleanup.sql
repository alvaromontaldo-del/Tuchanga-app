-- #123 Storage: borrar fotos/videos de cuentas eliminadas + limpieza semanal de huérfanos.
-- Hosted Supabase bloquea DELETE directo en storage.objects (storage.protect_delete).
-- El borrado real lo hace la Edge Function cleanup_orphan_storage vía Storage API (service_role).
-- Esta migración: listado seguro de huérfanos, invoke por pg_net, enganche en delete_user_account,
-- cron semanal. REVOKE a anon/authenticated.

CREATE TABLE IF NOT EXISTS public.storage_cleanup_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL,
  dry_run boolean NOT NULL DEFAULT false,
  user_id uuid NULL,
  candidates int NOT NULL DEFAULT 0,
  removed int NOT NULL DEFAULT 0,
  bytes_candidates bigint NOT NULL DEFAULT 0,
  bytes_removed bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.storage_cleanup_log IS
  '#123 Bitácora de limpiezas de storage (huérfanos / baja de cuenta). Solo service_role/postgres.';

ALTER TABLE public.storage_cleanup_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.storage_cleanup_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.storage_cleanup_log TO postgres, service_role;

-- Extrae path relativo de una URL pública/firmada de Storage, o NULL.
CREATE OR REPLACE FUNCTION public.storage_path_from_url(p_url text, p_bucket text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT NULLIF(
    substring(
      nullif(btrim(coalesce(p_url, '')), '')
      from ('/storage/v1/object/(?:public|sign)/' || p_bucket || '/(.+?)(?:\?|$)')
    ),
    ''
  );
$fn$;

REVOKE ALL ON FUNCTION public.storage_path_from_url(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_path_from_url(text, text) TO postgres, service_role;

-- Conjunto de (bucket, path) todavía referenciados por filas vivas.
CREATE OR REPLACE FUNCTION public.storage_referenced_paths()
RETURNS TABLE (bucket_id text, object_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT DISTINCT bucket_id, object_path
  FROM (
    SELECT 'avatars'::text AS bucket_id,
           public.storage_path_from_url(p.avatar_url, 'avatars') AS object_path
    FROM public.profiles p
    WHERE coalesce(p.avatar_url, '') <> ''

    UNION ALL
    SELECT 'avatars',
           public.storage_path_from_url(s.avatar_url, 'avatars')
    FROM public.stores s
    WHERE coalesce(s.avatar_url, '') <> ''

    UNION ALL
    SELECT 'worker_videos',
           nullif(btrim(coalesce(p.intro_video_path, '')), '')
    FROM public.profiles p
    WHERE coalesce(p.intro_video_path, '') <> ''

    UNION ALL
    SELECT 'job-photos',
           public.storage_path_from_url(j.foto_url, 'job-photos')
    FROM public.jobs j
    WHERE coalesce(j.foto_url, '') <> ''

    UNION ALL
    SELECT 'job-photos',
           public.storage_path_from_url(u, 'job-photos')
    FROM public.jobs j
    CROSS JOIN LATERAL unnest(coalesce(j.photo_urls, '{}'::text[])) AS u
    WHERE j.photo_urls IS NOT NULL

    UNION ALL
    SELECT 'job-photos',
           public.storage_path_from_url(u, 'job-photos')
    FROM public.posts p
    CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[])) AS u
    WHERE p.image_urls IS NOT NULL

    UNION ALL
    -- Chat: mensajes de imagen (si quedan) y cualquier body con URL de storage.
    SELECT
      coalesce(
        public.chat_image_storage_bucket(m.body),
        CASE
          WHEN m.body ILIKE '%/object/%/avatars/%' THEN 'avatars'
          WHEN m.body ILIKE '%/object/%/worker_videos/%' THEN 'worker_videos'
          WHEN m.body ILIKE '%/object/%/chat/%' THEN 'chat'
          ELSE 'job-photos'
        END
      ),
      coalesce(
        public.chat_image_storage_path(m.body),
        public.storage_path_from_url(m.body, 'job-photos'),
        public.storage_path_from_url(m.body, 'avatars'),
        public.storage_path_from_url(m.body, 'chat'),
        public.storage_path_from_url(m.body, 'worker_videos')
      )
    FROM public.messages m
    WHERE m.body ILIKE '%/storage/v1/object/%'
       OR m.type = 'image'
  ) x
  WHERE object_path IS NOT NULL AND object_path <> '';
$fn$;

REVOKE ALL ON FUNCTION public.storage_referenced_paths() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_referenced_paths() TO postgres, service_role;

-- Lista candidatos a borrar. mode=orphans (gracia 7d) | user (carpeta del usuario).
CREATE OR REPLACE FUNCTION public.list_unreferenced_storage_objects(
  p_mode text DEFAULT 'orphans',
  p_user_id uuid DEFAULT NULL,
  p_min_age_days int DEFAULT 7,
  p_limit int DEFAULT 5000
)
RETURNS TABLE (
  bucket_id text,
  object_path text,
  bytes bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'storage'
AS $fn$
DECLARE
  v_mode text := lower(btrim(coalesce(p_mode, 'orphans')));
  v_age int := greatest(coalesce(p_min_age_days, 7), 0);
  v_limit int := least(greatest(coalesce(p_limit, 5000), 1), 20000);
BEGIN
  IF v_mode NOT IN ('orphans', 'user') THEN
    RAISE EXCEPTION 'p_mode inválido (orphans|user)';
  END IF;
  IF v_mode = 'user' AND p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id requerido para mode=user';
  END IF;

  RETURN QUERY
  SELECT
    o.bucket_id::text,
    o.name::text AS object_path,
    coalesce((o.metadata->>'size')::bigint, 0) AS bytes,
    o.created_at
  FROM storage.objects o
  WHERE o.bucket_id IN ('avatars', 'job-photos', 'worker_videos', 'chat')
    AND coalesce(o.is_delete_marker, false) IS NOT TRUE
    AND (
      v_mode = 'user'
      AND (
        o.owner = p_user_id
        OR o.owner_id::text = p_user_id::text
        OR o.name LIKE p_user_id::text || '/%'
        OR o.name LIKE '%/' || p_user_id::text || '/%'
      )
      OR (
        v_mode = 'orphans'
        AND o.created_at < now() - make_interval(days => v_age)
        AND NOT EXISTS (
          SELECT 1
          FROM public.storage_referenced_paths() r
          WHERE r.bucket_id = o.bucket_id
            AND r.object_path = o.name
        )
      )
    )
  ORDER BY o.created_at ASC
  LIMIT v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_unreferenced_storage_objects(text, uuid, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_unreferenced_storage_objects(text, uuid, int, int)
  TO postgres, service_role;

-- Resume dry-run (conteos) sin borrar.
CREATE OR REPLACE FUNCTION public.storage_cleanup_dry_run(
  p_mode text DEFAULT 'orphans',
  p_user_id uuid DEFAULT NULL,
  p_min_age_days int DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count int := 0;
  v_bytes bigint := 0;
  v_by_bucket jsonb := '{}'::jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT bucket_id, count(*)::int AS n, coalesce(sum(bytes), 0)::bigint AS b
    FROM public.list_unreferenced_storage_objects(p_mode, p_user_id, p_min_age_days, 20000)
    GROUP BY bucket_id
  LOOP
    v_count := v_count + r.n;
    v_bytes := v_bytes + r.b;
    v_by_bucket := v_by_bucket || jsonb_build_object(
      r.bucket_id,
      jsonb_build_object('count', r.n, 'bytes', r.b)
    );
  END LOOP;

  INSERT INTO public.storage_cleanup_log (mode, dry_run, user_id, candidates, bytes_candidates, details)
  VALUES (
    lower(btrim(coalesce(p_mode, 'orphans'))),
    true,
    p_user_id,
    v_count,
    v_bytes,
    jsonb_build_object('by_bucket', v_by_bucket, 'min_age_days', coalesce(p_min_age_days, 7))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'mode', lower(btrim(coalesce(p_mode, 'orphans'))),
    'candidates', v_count,
    'bytes', v_bytes,
    'by_bucket', v_by_bucket
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.storage_cleanup_dry_run(text, uuid, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_cleanup_dry_run(text, uuid, int)
  TO postgres, service_role;

-- La Edge Function registra el resultado real tras borrar.
CREATE OR REPLACE FUNCTION public.storage_cleanup_record_result(
  p_mode text,
  p_user_id uuid,
  p_candidates int,
  p_removed int,
  p_bytes_candidates bigint,
  p_bytes_removed bigint,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.storage_cleanup_log (
    mode, dry_run, user_id, candidates, removed,
    bytes_candidates, bytes_removed, details
  ) VALUES (
    lower(btrim(coalesce(p_mode, 'orphans'))),
    false,
    p_user_id,
    coalesce(p_candidates, 0),
    coalesce(p_removed, 0),
    coalesce(p_bytes_candidates, 0),
    coalesce(p_bytes_removed, 0),
    coalesce(p_details, '{}'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.storage_cleanup_record_result(text, uuid, int, int, bigint, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_cleanup_record_result(text, uuid, int, int, bigint, bigint, jsonb)
  TO postgres, service_role;

-- Invoca la Edge Function (async). URL derivada del trigger YaChanga; secreto desde vault.
CREATE OR REPLACE FUNCTION public.invoke_cleanup_orphan_storage(
  p_mode text DEFAULT 'orphans',
  p_user_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT false,
  p_min_age_days int DEFAULT 7
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_secret text;
  v_def text;
  v_args text[];
  v_url text;
  v_mode text := lower(btrim(coalesce(p_mode, 'orphans')));
BEGIN
  IF v_mode NOT IN ('orphans', 'user') THEN
    RAISE EXCEPTION 'p_mode inválido';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'edge_function_secret'
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'invoke_cleanup_orphan_storage: falta vault edge_function_secret';
    RETURN;
  END IF;

  SELECT pg_get_triggerdef(t.oid, true) INTO v_def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND n.nspname = 'public'
    AND c.relname = 'messages'
    AND t.tgname = 'YaChanga';

  IF v_def IS NULL THEN
    RAISE WARNING 'invoke_cleanup_orphan_storage: falta el trigger YaChanga';
    RETURN;
  END IF;

  v_args := public._edge_http_request_args(v_def);
  v_url := regexp_replace(
    coalesce(v_args[1], ''),
    '/functions/v1/[^/?]+$',
    '/functions/v1/cleanup_orphan_storage'
  );
  IF v_url = '' OR v_url NOT LIKE '%/functions/v1/cleanup_orphan_storage' THEN
    RAISE WARNING 'invoke_cleanup_orphan_storage: no se pudo derivar la URL';
    RETURN;
  END IF;

  PERFORM net.http_post(
    v_url,
    jsonb_build_object(
      'mode', v_mode,
      'user_id', p_user_id,
      'dry_run', coalesce(p_dry_run, false),
      'min_age_days', coalesce(p_min_age_days, 7)
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-function-secret', v_secret
    ),
    5000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_cleanup_orphan_storage: %', SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_cleanup_orphan_storage(text, uuid, boolean, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_cleanup_orphan_storage(text, uuid, boolean, int)
  TO postgres, service_role;

-- Enganche en delete_user_account: dispara limpieza de carpeta del usuario (async)
-- antes de borrar el perfil. Reemplaza el DELETE directo a storage.objects (bloqueado).
CREATE OR REPLACE FUNCTION public.delete_user_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_email text;
  v_store_ids uuid[];
  v_post_ids uuid[];
  v_quote_ids uuid[];
  v_mr_ids uuid[];
  v_conv_ids uuid[];
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- #123: pedir borrado de archivos del usuario vía Edge (Storage API). Async.
  BEGIN
    PERFORM public.invoke_cleanup_orphan_storage('user', uid, false, 0);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'delete_user_account storage cleanup: %', SQLERRM;
  END;

  BEGIN
    PERFORM public.archive_account_baja(uid, 'user', NULL, 'Eliminación desde la app');
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  SELECT lower(trim(u.email)) INTO v_email
  FROM auth.users u
  WHERE u.id = uid;

  SELECT coalesce(array_agg(s.id), '{}'::uuid[]) INTO v_store_ids
  FROM public.stores s
  WHERE s.user_id = uid;

  BEGIN
    SELECT coalesce(array_agg(mr.id), '{}'::uuid[]) INTO v_mr_ids
    FROM public.material_requests mr
    WHERE mr.client_id = uid OR mr.professional_id = uid;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_mr_ids := '{}'::uuid[];
  END;

  SELECT coalesce(array_agg(DISTINCT q.id), '{}'::uuid[]) INTO v_quote_ids
  FROM public.quotes q
  WHERE q.client_id = uid
     OR (coalesce(array_length(v_store_ids, 1), 0) > 0 AND q.store_id = ANY (v_store_ids))
     OR (
       coalesce(array_length(v_mr_ids, 1), 0) > 0
       AND q.request_id = ANY (v_mr_ids)
     );

  IF coalesce(array_length(v_quote_ids, 1), 0) > 0 THEN
    BEGIN
      DELETE FROM public.orders o WHERE o.quote_id = ANY (v_quote_ids) OR o.client_id = uid;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;
    BEGIN
      DELETE FROM public.quote_items qi WHERE qi.quote_id = ANY (v_quote_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    DELETE FROM public.quotes q WHERE q.id = ANY (v_quote_ids);
  ELSE
    BEGIN
      DELETE FROM public.orders o WHERE o.client_id = uid;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;
  END IF;

  BEGIN
    DELETE FROM public.material_checkouts mc WHERE mc.client_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  IF coalesce(array_length(v_mr_ids, 1), 0) > 0 THEN
    BEGIN
      DELETE FROM public.request_target_stores rts WHERE rts.request_id = ANY (v_mr_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.request_items ri WHERE ri.request_id = ANY (v_mr_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    DELETE FROM public.material_requests mr WHERE mr.id = ANY (v_mr_ids);
  END IF;

  IF coalesce(array_length(v_store_ids, 1), 0) > 0 THEN
    BEGIN
      DELETE FROM public.request_target_stores rts WHERE rts.store_id = ANY (v_store_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.store_push_events spe WHERE spe.store_id = ANY (v_store_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.store_rubros sr WHERE sr.store_id = ANY (v_store_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    DELETE FROM public.stores s WHERE s.id = ANY (v_store_ids);
  END IF;

  SELECT coalesce(array_agg(p.id), '{}'::uuid[]) INTO v_post_ids
  FROM public.posts p
  WHERE p.worker_id = uid;

  IF coalesce(array_length(v_post_ids, 1), 0) > 0 THEN
    BEGIN
      DELETE FROM public.post_likes pl WHERE pl.post_id = ANY (v_post_ids) OR pl.user_id = uid;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.publicaciones_ocultas h
      WHERE h.publicacion_id = ANY (v_post_ids) OR h.user_id = uid;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;
    DELETE FROM public.posts p WHERE p.id = ANY (v_post_ids);
  ELSE
    BEGIN
      DELETE FROM public.post_likes pl WHERE pl.user_id = uid;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.publicaciones_ocultas h WHERE h.user_id = uid;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END IF;

  DELETE FROM public.jobs WHERE user_id = uid;

  BEGIN
    DELETE FROM public.professional_jobs_archive a
    WHERE a.source_user_id = uid
       OR (v_email IS NOT NULL AND lower(trim(a.email)) = v_email);
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    DELETE FROM public.worker_reviews wr
    WHERE wr.worker_id = uid OR wr.client_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.favorites f
    WHERE f.user_id = uid OR f.professional_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.professional_agenda_blocks b WHERE b.worker_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  SELECT coalesce(array_agg(DISTINCT c.id), '{}'::uuid[]) INTO v_conv_ids
  FROM public.conversations c
  WHERE c.cliente_id = uid OR c.trabajador_id = uid;

  IF coalesce(array_length(v_conv_ids, 1), 0) > 0 THEN
    BEGIN
      DELETE FROM public.messages m WHERE m.conversation_id = ANY (v_conv_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.conversation_reads r WHERE r.conversation_id = ANY (v_conv_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.conversation_hides h WHERE h.conversation_id = ANY (v_conv_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    BEGIN
      DELETE FROM public.chat_quotes cq WHERE cq.conversation_id = ANY (v_conv_ids);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    DELETE FROM public.conversations c WHERE c.id = ANY (v_conv_ids);
  END IF;

  BEGIN
    DELETE FROM public.contrataciones ct
    WHERE ct.client_id = uid OR ct.worker_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.transacciones_pago tp WHERE tp.cliente_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.pin_intentos pi WHERE pi.actor_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.user_blocks b
    WHERE b.blocker_id = uid OR b.blocked_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.user_reports r
    WHERE r.reporter_id = uid OR r.reported_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.push_tokens t WHERE t.user_id = uid;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  UPDATE public.profiles
  SET professional_reviewed_by = NULL
  WHERE professional_reviewed_by = uid;

  BEGIN
    UPDATE public.stores
    SET approved_by = NULL
    WHERE approved_by = uid;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  -- #123: ya no DELETE directo a storage.objects (protect_delete). La Edge lo hace.

  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;

  RETURN jsonb_build_object('ok', true, 'userId', uid);
END;
$function$;

-- Cron semanal: domingos 04:00 America/Buenos_Aires ≈ 07:00 UTC
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage_orphan_cleanup_weekly') THEN
    PERFORM cron.unschedule('storage_orphan_cleanup_weekly');
  END IF;
  PERFORM cron.schedule(
    'storage_orphan_cleanup_weekly',
    '0 7 * * 0',
    $cmd$SELECT public.invoke_cleanup_orphan_storage('orphans', NULL, false, 7);$cmd$
  );
END;
$cron$;

-- Valida el secreto de Edge contra vault (solo service_role).
CREATE OR REPLACE FUNCTION public.verify_edge_function_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets s
    WHERE s.name = 'edge_function_secret'
      AND s.decrypted_secret = nullif(btrim(coalesce(p_secret, '')), '')
  );
$fn$;

REVOKE ALL ON FUNCTION public.verify_edge_function_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_edge_function_secret(text) TO postgres, service_role;
