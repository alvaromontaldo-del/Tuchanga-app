-- Ticket #46 — Webhook de push al comercio.
--
-- public.store_push_events se encolaba, pero no había trigger: push_on_store_board
-- no corría. El chat sí, porque public.messages tiene el trigger "YaChanga"
-- → /functions/v1/push_on_message.
--
-- Recrea "YaChanga_store_push" (AFTER INSERT, FOR EACH ROW) de forma idempotente.
-- Ya está aplicado en producción (TuChangaAPP). No incluye JWT ni anon key: copia
-- method, headers y timeout del trigger "YaChanga" y solo cambia la URL a
-- /functions/v1/push_on_store_board.
--
-- Si "YaChanga" no existe, copiá esos headers del Database Webhook de messages
-- en el dashboard (mismo patrón). No commitees la anon key.
--
-- Dedup: la Edge push_on_store_board reclama cada entrega con claimPushDelivery
-- (clave store_push:{id}). enqueue_store_push además ignora un duplicado del
-- mismo store + type + data durante 3 minutos.

DO $migration$
DECLARE
  src_def text;
  stmt text;
BEGIN
  SELECT pg_get_triggerdef(t.oid, true)
    INTO src_def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND n.nspname = 'public'
    AND c.relname = 'messages'
    AND t.tgname = 'YaChanga';

  IF src_def IS NULL THEN
    RAISE EXCEPTION
      USING MESSAGE =
        'Falta el trigger "YaChanga" en public.messages. '
        'Creá "YaChanga_store_push" AFTER INSERT ON public.store_push_events '
        'EXECUTE FUNCTION supabase_functions.http_request(...), copiando method, '
        'headers y timeout del Database Webhook de messages, con URL '
        'https://<project-ref>.supabase.co/functions/v1/push_on_store_board. '
        'No hardcodees la anon key en el repositorio.';
  END IF;

  IF src_def !~ '/functions/v1/push_on_message' THEN
    RAISE EXCEPTION
      'El trigger "YaChanga" no apunta a /functions/v1/push_on_message; no se reutilizan sus headers.';
  END IF;

  stmt := replace(
    regexp_replace(
      regexp_replace(
        src_def,
        '^CREATE TRIGGER\s+"?YaChanga"?',
        'CREATE TRIGGER "YaChanga_store_push"'
      ),
      '\mON\s+(public\.)?messages\M',
      'ON public.store_push_events'
    ),
    '/functions/v1/push_on_message',
    '/functions/v1/push_on_store_board'
  );

  IF stmt !~ '^CREATE TRIGGER "YaChanga_store_push" AFTER INSERT ON public\.store_push_events '
     OR stmt !~ 'supabase_functions\.http_request\('
     OR stmt !~ '/functions/v1/push_on_store_board'
     OR stmt ~ 'push_on_message'
     OR stmt ~ 'YaChanga"'
  THEN
    RAISE EXCEPTION 'No se pudo derivar YaChanga_store_push desde el trigger YaChanga.';
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS "YaChanga_store_push" ON public.store_push_events';
  EXECUTE stmt;
END
$migration$;

COMMENT ON TABLE public.store_push_events IS
  'Cola de pushes al dueño del comercio (#46). Trigger YaChanga_store_push AFTER INSERT llama a la Edge push_on_store_board, que deduplica con claimPushDelivery (store_push:{id}).';
