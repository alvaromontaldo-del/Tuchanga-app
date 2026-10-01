-- #65 — Headers de secreto para Edge Functions disparadas desde la base.
-- NO aplicar desde el agente. Lo corre un revisor en el SQL editor de TuChangaAPP
-- DESPUÉS de guardar el secreto y ANTES de redeployar las functions.
--
-- Quién llama a cada función (no hardcodear la anon key ni el secreto):
--
--   push_on_message
--     Trigger "YaChanga" AFTER INSERT ON public.messages
--     (supabase_functions.http_request). La app no la invoca.
--   push_on_store_board
--     Trigger "YaChanga_store_push" AFTER INSERT ON public.store_push_events.
--     Cubre solicitudes nuevas (trg_request_target_store_push_new →
--     enqueue_store_push) y cambios de estado del pedido.
--     La app también hace invoke de respaldo (materialRequestsSupabase.ts);
--     sin el secreto en el cliente ese invoke responde 401. El trigger es el
--     camino que tiene que seguir andando.
--   push_on_review
--     Hoy la app invoca desde quotesSupabase.createReview. No hay trigger en
--     las migraciones (el webhook de worker_reviews es solo una nota de
--     dashboard). Este script crea "YaChanga_review" clonando "YaChanga".
--   cleanup_chat_images
--     Cron del dashboard (Edge Functions → Schedules), no es un trigger.
--     La app invoca desde chatCleanupSupabase.ts (401 sin secreto en el
--     cliente). Este script agrega:
--       trg_worker_reviews_cleanup_chat_images
--       trg_contrataciones_cleanup_chat_images
--     que hacen net.http_post con el secreto leído de Vault en el momento.
--   mp_crear_preferencia / mp_confirmar_sena
--     La app (pagosMercadoPago.ts) con el access token del usuario.
--     verify_jwt = true. No usan este secreto.
--   mp_webhook
--     Mercado Pago. verify_jwt = false. Exige MP_WEBHOOK_SECRET y x-signature.
--   mp_retorno
--     Redirect HTTPS del checkout (sin JWT). verify_jwt = false.
--     Acredita solo si el pago reconsultado coincide en monto y referencia.
--
-- Dónde configurar el secreto (el mismo valor en los tres lugares, sin pegarlo acá):
--
--   1. Edge Functions → Secrets
--        EDGE_FUNCTION_SECRET
--        (si ya existe CLEANUP_CRON_SECRET y no vas a setear el canónico,
--         el código lo acepta como alias; mejor unificar en EDGE_FUNCTION_SECRET)
--   2. Vault (lo leen este script y invoke_cleanup_chat_images):
--        select vault.create_secret(
--          '<mismo valor>',
--          'edge_function_secret',
--          'Header x-function-secret de push_* y cleanup_chat_images'
--        );
--      Si el secreto ya existe, actualizalo en Vault y volvé a correr este script
--      para reescribir los headers de los triggers http_request (quedan copiados
--      en la definición del trigger).
--   3. Headers
--        x-function-secret: <mismo valor>
--        Este script lo agrega a los triggers http_request de
--        push_on_message, push_on_review, push_on_store_board y
--        cleanup_chat_images, sin borrar Authorization ni el resto.
--        Cron de cleanup_chat_images: en el schedule, header x-function-secret
--        (x-cleanup-secret sigue valiendo como alias). Authorization Bearer
--        service_role ya no alcanza.
--
-- Orden: Vault + este SQL + header del cron, y recién después el deploy de
-- las functions. Si se deploya antes, los triggers viejos reciben 401.

CREATE OR REPLACE FUNCTION public._edge_http_request_args(p_def text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i int;
  n int;
  c text;
  buf text;
  out text[] := ARRAY[]::text[];
  in_str boolean := false;
  start_at int;
BEGIN
  start_at := position('http_request(' in coalesce(p_def, ''));
  IF start_at = 0 THEN
    RETURN out;
  END IF;
  i := start_at + length('http_request(');
  n := length(p_def);
  WHILE i <= n AND cardinality(out) < 5 LOOP
    c := substr(p_def, i, 1);
    IF NOT in_str THEN
      IF c = '''' THEN
        in_str := true;
        buf := '';
      END IF;
      i := i + 1;
    ELSE
      IF c = '''' THEN
        IF i < n AND substr(p_def, i + 1, 1) = '''' THEN
          buf := buf || '''';
          i := i + 2;
        ELSE
          out := array_append(out, buf);
          in_str := false;
          i := i + 1;
        END IF;
      ELSE
        buf := buf || c;
        i := i + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public._edge_http_request_args(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._edge_http_request_args(text) FROM anon, authenticated;

DO $secret_headers$
DECLARE
  v_secret text;
  v_rec record;
  v_args text[];
  v_headers jsonb;
  v_url text;
  v_method text;
  v_params text;
  v_timeout text;
  v_stmt text;
  v_message_url text;
  v_message_method text;
  v_message_headers jsonb;
  v_message_params text;
  v_message_timeout text;
  v_review_stmt text;
  v_has_review boolean := false;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'edge_function_secret'
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE EXCEPTION
      'Falta vault.decrypted_secrets name=edge_function_secret. '
      'Crealo con el mismo valor que el secret EDGE_FUNCTION_SECRET y volvé a correr este script. '
      'No pegues el valor en el repositorio.';
  END IF;

  FOR v_rec IN
    SELECT t.tgname, n.nspname, c.relname, pg_get_triggerdef(t.oid, true) AS def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND pg_get_triggerdef(t.oid, true) LIKE '%supabase_functions.http_request%'
      AND (
        pg_get_triggerdef(t.oid, true) LIKE '%/functions/v1/push_on_%'
        OR pg_get_triggerdef(t.oid, true) LIKE '%/functions/v1/cleanup_chat_images%'
      )
  LOOP
    IF v_rec.def !~ 'AFTER INSERT'
       OR v_rec.def ~ 'INSERT OR'
       OR v_rec.def ~ 'OR UPDATE'
       OR v_rec.def ~ 'OR DELETE'
    THEN
      RAISE EXCEPTION
        'El trigger % no es AFTER INSERT simple. Agregá el header x-function-secret a mano en el dashboard, sin commitear el secreto.',
        v_rec.tgname;
    END IF;

    v_args := public._edge_http_request_args(v_rec.def);
    IF cardinality(v_args) < 3 THEN
      RAISE EXCEPTION
        'No se leyeron los argumentos http_request del trigger %. Actualizá el header x-function-secret a mano.',
        v_rec.tgname;
    END IF;

    v_url := v_args[1];
    v_method := coalesce(nullif(v_args[2], ''), 'POST');
    v_headers := coalesce(v_args[3]::jsonb, '{}'::jsonb)
      || jsonb_build_object('x-function-secret', v_secret);
    v_params := coalesce(v_args[4], '{}');
    v_timeout := coalesce(v_args[5], '5000');

    IF v_rec.tgname = 'YaChanga' AND v_rec.relname = 'messages' THEN
      v_message_url := v_url;
      v_message_method := v_method;
      v_message_headers := v_headers;
      v_message_params := v_params;
      v_message_timeout := v_timeout;
    END IF;

    IF v_url LIKE '%/functions/v1/push_on_review%' THEN
      v_has_review := true;
    END IF;

    v_stmt := format(
      'CREATE TRIGGER %I AFTER INSERT ON %I.%I FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
      v_rec.tgname,
      v_rec.nspname,
      v_rec.relname,
      v_url,
      v_method,
      v_headers::text,
      v_params,
      v_timeout
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      v_rec.tgname,
      v_rec.nspname,
      v_rec.relname
    );
    EXECUTE v_stmt;
    RAISE NOTICE 'trigger %: header x-function-secret actualizado', v_rec.tgname;
  END LOOP;

  IF v_message_url IS NULL THEN
    RAISE EXCEPTION
      'Falta el trigger "YaChanga" en public.messages apuntando a /functions/v1/push_on_message. '
      'No se pueden clonar headers para push_on_review.';
  END IF;

  IF NOT v_has_review THEN
    IF v_message_url !~ '/functions/v1/push_on_message$' THEN
      RAISE EXCEPTION
        'El trigger YaChanga no termina en /functions/v1/push_on_message. No se clona push_on_review.';
    END IF;
    v_review_stmt := format(
      'CREATE TRIGGER %I AFTER INSERT ON public.worker_reviews FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
      'YaChanga_review',
      regexp_replace(v_message_url, '/functions/v1/push_on_message$', '/functions/v1/push_on_review'),
      v_message_method,
      v_message_headers::text,
      v_message_params,
      v_message_timeout
    );
    EXECUTE 'DROP TRIGGER IF EXISTS "YaChanga_review" ON public.worker_reviews';
    EXECUTE v_review_stmt;
    RAISE NOTICE 'trigger YaChanga_review creado en worker_reviews';
  END IF;
END
$secret_headers$;

-- Limpieza de imágenes: el secreto se lee de Vault en cada llamada (no queda
-- copiado en esta función). La URL sale del trigger YaChanga.
CREATE OR REPLACE FUNCTION public.invoke_cleanup_chat_images(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_def text;
  v_args text[];
  v_url text;
BEGIN
  IF p_contratacion_id IS NULL THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'edge_function_secret'
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'invoke_cleanup_chat_images: falta vault edge_function_secret';
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
    RAISE WARNING 'invoke_cleanup_chat_images: falta el trigger YaChanga';
    RETURN;
  END IF;

  v_args := public._edge_http_request_args(v_def);
  v_url := regexp_replace(
    coalesce(v_args[1], ''),
    '/functions/v1/[^/?]+$',
    '/functions/v1/cleanup_chat_images'
  );
  IF v_url = '' OR v_url NOT LIKE '%/functions/v1/cleanup_chat_images' THEN
    RAISE WARNING 'invoke_cleanup_chat_images: no se pudo derivar la URL';
    RETURN;
  END IF;

  PERFORM net.http_post(
    v_url,
    jsonb_build_object('contratacion_id', p_contratacion_id),
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-function-secret', v_secret
    ),
    5000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_cleanup_chat_images: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_cleanup_chat_images(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_cleanup_chat_images(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_cleanup_chat_images_http()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'worker_reviews' THEN
    v_id := NEW.job_id;
  ELSIF TG_TABLE_NAME = 'contrataciones' THEN
    v_id := NEW.id;
  END IF;

  IF v_id IS NOT NULL THEN
    PERFORM public.invoke_cleanup_chat_images(v_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_cleanup_chat_images_http() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_cleanup_chat_images_http() FROM anon;
GRANT EXECUTE ON FUNCTION public.trg_cleanup_chat_images_http() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_worker_reviews_cleanup_chat_images ON public.worker_reviews;
CREATE TRIGGER trg_worker_reviews_cleanup_chat_images
  AFTER INSERT ON public.worker_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_cleanup_chat_images_http();

DROP TRIGGER IF EXISTS trg_contrataciones_cleanup_chat_images ON public.contrataciones;
CREATE TRIGGER trg_contrataciones_cleanup_chat_images
  AFTER UPDATE OF estado_pago ON public.contrataciones
  FOR EACH ROW
  WHEN (
    NEW.estado_pago = 'totalmente_pagado'
    AND OLD.estado_pago IS DISTINCT FROM NEW.estado_pago
  )
  EXECUTE FUNCTION public.trg_cleanup_chat_images_http();

COMMENT ON FUNCTION public.invoke_cleanup_chat_images(uuid) IS
  'POST a cleanup_chat_images con x-function-secret desde Vault (edge_function_secret). No grant a anon/authenticated.';
