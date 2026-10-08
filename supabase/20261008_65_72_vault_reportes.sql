-- YaChanga #65 y #72. Un solo script. Lo corre el coordinador en el SQL editor.
-- NO está aplicado. NO rota el secreto. NO despliega edge functions.
--
-- Producción (kyxehrxcdealbujvvnxp), leído el 2026-10-08:
--   * "YaChanga", "YaChanga_store_push" y "YaChanga_review" son AFTER INSERT
--     y llaman a supabase_functions.http_request(..., timeout 5000).
--     Headers de hoy: apikey (anon key pública), Content-type application/json,
--     Authorization Bearer de esa misma anon key, y x-function-secret en texto plano.
--     El valor de x-function-secret coincide con vault.decrypted_secrets
--     name = edge_function_secret (se comparó en SQL, sin copiarlo acá).
--   * El payload de http_request es
--     {old_record, record, type, table, schema} con type = TG_OP (INSERT).
--   * invoke_cleanup_chat_images ya lee Vault. Derivaba la URL parseando el
--     trigger YaChanga. Al dejar de ser http_request, esa derivación se corta:
--     la URL queda fija y el secreto sigue saliendo de Vault. Headers de la
--     purga, sin cambios: Content-Type y x-function-secret, timeout 5000.
--   * cliente_responder_conformidad es el cuerpo vivo (el de #206: disputa,
--     conformidad_rechazada al cliente y disputa_abierta al profesional).
--     Firma y grants iguales. anon no tiene EXECUTE.
--
-- #65: los tres webhooks pasan a un trigger AFTER INSERT que llama a
-- public.trg_vault_edge_webhook(). Esa función arma el mismo payload y llama a
-- public.invoke_vault_edge_webhook(), SECURITY DEFINER, search_path fijo, que
-- lee el secreto de Vault en el momento del POST. El secreto no queda en
-- pg_trigger. EXECUTE de las dos funciones: se revoca a anon y authenticated.
--
-- #72: en la rama no conforme se inserta user_reports
-- (reason = 'Tuve un problema', contratacion_id = el trabajo).
-- El índice user_reports_reporter_reported_unique pasa a ser parcial
-- WHERE contratacion_id IS NULL: el reporte de chat sigue siendo uno por par
-- (report_user busca ese nombre en el error). Cada «no conforme» puede insertar
-- otra fila. El mail lo dispara el trigger AFTER INSERT, con el mismo helper
-- de Vault, hacia notify_trabajo_no_conforme. Si el POST falla, el trigger
-- avisa y no revierte la disputa ni la fila (pg_net además es asíncrono:
-- el HTTP no corre dentro de la transacción).
--
-- Rotación del secreto (NO la hace este script; hacerla después de verificar):
--   1. Generar un valor nuevo. No commitearlo.
--   2. Actualizar Vault, sin recrear los triggers (ya no copian el valor):
--        SELECT vault.update_secret(
--          (SELECT id FROM vault.secrets WHERE name = 'edge_function_secret'),
--          '<nuevo valor>',
--          'edge_function_secret',
--          'Header x-function-secret de push_*, cleanup_chat_images y notify_trabajo_no_conforme'
--        );
--   3. Las edge functions resuelven primero la env EDGE_FUNCTION_SECRET y, si
--      está vacía, el alias CLEANUP_CRON_SECRET. Solo si ambas están vacías
--      leen Vault. Si alguna env está seteada con el valor viejo, hay que
--      actualizarla al mismo valor nuevo en Dashboard → Edge Functions →
--      Secrets, en la misma ventana. Si no, la función responde 401 y se
--      cortan los push, la purga y el mail.
--   4. El cron de cleanup_chat_images está en el dashboard (Edge Functions →
--      Schedules), no en cron.job. Si ese schedule manda x-function-secret
--      a mano, actualizar ese header al valor nuevo. Los dos cron de pg_cron
--      (conformidad_automatica_72h y storage_orphan_cleanup_weekly) no lo usan.
--   5. Verificar enseguida: mensaje de chat → push, reseña → push, pedido de
--      materiales → push al comercio, y un POST de purga sin 401.
--
-- Orden de despliegue (el coordinador, no este script):
--   1. Este SQL.
--   2. Deploy de notify_trabajo_no_conforme con verify_jwt = false
--      (el trigger no manda JWT de usuario; autentica con x-function-secret).
--   3. Redeploy de report_user con verify_jwt = false, como hoy, para que el
--      duplicado de chat ignore las filas con contratacion_id.
--      Si se despliega report_user antes de la columna, el reporte de chat
--      falla. El mail nuevo puede desplegarse después del SQL: hasta entonces
--      el POST da 404 y la disputa igual queda guardada.
--   4. No rotar el secreto en el mismo paso. Primero QA con el valor actual.
--   5. Merge del PR con [skip ci]: no hay cambios de app ni OTA.

BEGIN;

DO $vault_ok$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_secret'
      AND btrim(coalesce(decrypted_secret, '')) <> ''
  ) THEN
    RAISE EXCEPTION 'Falta vault.decrypted_secrets name=edge_function_secret. No se reemplazan los triggers.';
  END IF;
END
$vault_ok$;

ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS contratacion_id uuid;

COMMENT ON COLUMN public.user_reports.contratacion_id IS
  '#72. NULL = reporte de chat (único por par). Con valor = disputa de conformidad de ese trabajo; puede haber más de una.';

DROP INDEX IF EXISTS public.user_reports_reporter_reported_unique;

CREATE UNIQUE INDEX user_reports_reporter_reported_unique
  ON public.user_reports (reporter_id, reported_id)
  WHERE contratacion_id IS NULL;

-- Lee Vault y hace el POST. No guarda el secreto en la definición.
-- Slugs cerrados: no es un HTTP genérico.
CREATE OR REPLACE FUNCTION public.invoke_vault_edge_webhook(
  p_slug text,
  p_payload jsonb,
  p_timeout_ms integer DEFAULT 5000
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  -- Anon key pública. Es la misma que el webhook http_request manda hoy en
  -- apikey y Authorization. No es el function secret.
  v_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5eGVocnhjZGVhbGJ1anZ2bnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Nzk2OTEsImV4cCI6MjA5MTI1NTY5MX0.Ef5iZCbrseW4TYxSScOiqpAP8lZrjaQi2OItzCU5W9Y';
  v_headers jsonb;
BEGIN
  IF p_slug IS NULL OR p_slug NOT IN (
    'push_on_message',
    'push_on_review',
    'push_on_store_board',
    'notify_trabajo_no_conforme'
  ) THEN
    RAISE WARNING 'invoke_vault_edge_webhook: slug no permitido';
    RETURN;
  END IF;

  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'edge_function_secret'
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'invoke_vault_edge_webhook: falta vault edge_function_secret';
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'apikey', v_anon,
    'Content-type', 'application/json',
    'Authorization', 'Bearer ' || v_anon,
    'x-function-secret', btrim(v_secret)
  );

  PERFORM net.http_post(
    'https://kyxehrxcdealbujvvnxp.supabase.co/functions/v1/' || p_slug,
    coalesce(p_payload, '{}'::jsonb),
    '{}'::jsonb,
    v_headers,
    coalesce(p_timeout_ms, 5000)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_vault_edge_webhook: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_vault_edge_webhook(text, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_vault_edge_webhook(text, jsonb, integer) FROM anon;
REVOKE ALL ON FUNCTION public.invoke_vault_edge_webhook(text, jsonb, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_vault_edge_webhook(text, jsonb, integer) TO service_role;

COMMENT ON FUNCTION public.invoke_vault_edge_webhook(text, jsonb, integer) IS
  '#65/#72. POST a una edge function con x-function-secret leído de Vault (edge_function_secret). Sin EXECUTE para anon ni authenticated.';

CREATE OR REPLACE FUNCTION public.trg_vault_edge_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
  v_payload jsonb;
BEGIN
  v_slug := CASE TG_TABLE_NAME
    WHEN 'messages' THEN 'push_on_message'
    WHEN 'store_push_events' THEN 'push_on_store_board'
    WHEN 'worker_reviews' THEN 'push_on_review'
    ELSE NULL
  END;

  IF v_slug IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mismo objeto que supabase_functions.http_request en un INSERT.
  v_payload := jsonb_build_object(
    'old_record', OLD,
    'record', NEW,
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA
  );

  PERFORM public.invoke_vault_edge_webhook(v_slug, v_payload, 5000);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_vault_edge_webhook() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_vault_edge_webhook() FROM anon;
REVOKE ALL ON FUNCTION public.trg_vault_edge_webhook() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trg_vault_edge_webhook() TO service_role;

COMMENT ON FUNCTION public.trg_vault_edge_webhook() IS
  '#65. AFTER INSERT de messages, store_push_events y worker_reviews. Reemplaza al webhook http_request. No incluye el secreto.';

-- Mismo nombre de trigger, misma tabla, mismo timing. El webhook viejo se
-- borra en esta transacción: si quedan los dos, el push se duplicaría.
DROP TRIGGER IF EXISTS "YaChanga" ON public.messages;
CREATE TRIGGER "YaChanga"
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_vault_edge_webhook();

DROP TRIGGER IF EXISTS "YaChanga_store_push" ON public.store_push_events;
CREATE TRIGGER "YaChanga_store_push"
  AFTER INSERT ON public.store_push_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_vault_edge_webhook();

DROP TRIGGER IF EXISTS "YaChanga_review" ON public.worker_reviews;
CREATE TRIGGER "YaChanga_review"
  AFTER INSERT ON public.worker_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_vault_edge_webhook();

-- Purga: mismo cuerpo vivo. Único cambio: la URL ya no sale de pg_get_triggerdef
-- de YaChanga (ese trigger dejó de ser http_request). Sigue leyendo Vault.
CREATE OR REPLACE FUNCTION public.invoke_cleanup_chat_images(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
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

  v_url := 'https://kyxehrxcdealbujvvnxp.supabase.co/functions/v1/cleanup_chat_images';

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
$function$;

REVOKE ALL ON FUNCTION public.invoke_cleanup_chat_images(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_cleanup_chat_images(uuid) FROM anon, authenticated;

COMMENT ON FUNCTION public.invoke_cleanup_chat_images(uuid) IS
  'POST a cleanup_chat_images con x-function-secret desde Vault (edge_function_secret). No grant a anon/authenticated.';

-- #72. El fallo del POST no revierte el INSERT (ni la disputa que lo causó).
CREATE OR REPLACE FUNCTION public.trg_user_reports_trabajo_no_conforme()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.reason IS DISTINCT FROM 'Tuve un problema' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.invoke_vault_edge_webhook(
      'notify_trabajo_no_conforme',
      jsonb_build_object(
        'old_record', NULL,
        'record', to_jsonb(NEW),
        'type', 'INSERT',
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA
      ),
      5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_user_reports_trabajo_no_conforme: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_user_reports_trabajo_no_conforme() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_user_reports_trabajo_no_conforme() FROM anon;
REVOKE ALL ON FUNCTION public.trg_user_reports_trabajo_no_conforme() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trg_user_reports_trabajo_no_conforme() TO service_role;

DROP TRIGGER IF EXISTS trg_user_reports_trabajo_no_conforme ON public.user_reports;
CREATE TRIGGER trg_user_reports_trabajo_no_conforme
  AFTER INSERT ON public.user_reports
  FOR EACH ROW
  WHEN (NEW.reason = 'Tuve un problema')
  EXECUTE FUNCTION public.trg_user_reports_trabajo_no_conforme();

-- Cuerpo vivo de cliente_responder_conformidad (2026-10-08, #206).
-- Único agregado: el INSERT en user_reports dentro del rechazo.
CREATE OR REPLACE FUNCTION public.cliente_responder_conformidad(
  p_contratacion_id uuid,
  p_conforme boolean,
  p_motivo_disputa text DEFAULT ''::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_motivo text;
  v_aviso_pro text;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede responder conformidad';
  END IF;

  IF v_row.estado_trabajo <> 'pendiente_conformidad' THEN
    RAISE EXCEPTION 'Estado inválido para responder conformidad';
  END IF;

  IF v_row.conformidad_solicitada_at IS NULL THEN
    RAISE EXCEPTION 'El trabajador aún no solicitó conformidad';
  END IF;

  IF v_row.conformidad_respondida_at IS NOT NULL THEN
    RAISE EXCEPTION 'La conformidad ya fue respondida';
  END IF;

  IF p_conforme THEN
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'finalizado',
      finalizado_at = now(),
      completed_by_worker_at = coalesce(completed_by_worker_at, now()),
      conformidad_respondida_at = now(),
      conformidad_aceptada = true
    WHERE id = p_contratacion_id;

    PERFORM public.hide_pair_chats_if_done(v_row.client_id, v_row.worker_id);

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      '✅ Confirmaste que el trabajo fue realizado correctamente. ¡Gracias! Podés dejar tu reseña.',
      jsonb_build_object(
        'event', 'conformidad_aceptada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );
  ELSE
    v_motivo := coalesce(trim(p_motivo_disputa), '');

    UPDATE public.contrataciones
    SET
      estado_trabajo = 'disputa',
      disputa_motivo = v_motivo,
      conformidad_respondida_at = now(),
      conformidad_aceptada = false
    WHERE id = p_contratacion_id;

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      'Indicaste un problema con el trabajo. Quedó en disputa y el chat sigue disponible. El saldo, si corresponde, se paga directo al profesional, fuera de la app.',
      jsonb_build_object(
        'event', 'conformidad_rechazada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );

    v_aviso_pro := 'El cliente marcó el trabajo como no conforme.';
    IF v_motivo <> '' THEN
      v_aviso_pro := v_aviso_pro || ' Motivo: ' || left(v_motivo, 600) || '.';
    END IF;
    v_aviso_pro := v_aviso_pro
      || ' El trabajo quedó en disputa: reparalo y marcá «Trabajo reparado».';

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      v_aviso_pro,
      jsonb_build_object(
        'event', 'disputa_abierta',
        'contratacion_id', p_contratacion_id,
        'audience', 'trabajador'
      )
    );

    INSERT INTO public.user_reports (
      reporter_id,
      reported_id,
      conversation_id,
      reason,
      details,
      contratacion_id
    ) VALUES (
      v_row.client_id,
      v_row.worker_id,
      v_row.conversation_id,
      'Tuve un problema',
      CASE
        WHEN v_motivo = '' THEN 'Trabajo ' || p_contratacion_id::text
        ELSE v_motivo || E'\nTrabajo ' || p_contratacion_id::text
      END,
      p_contratacion_id
    );
  END IF;
END;
$function$;

COMMIT;
