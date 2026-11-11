-- Chat bloqueado tras las dos conformidades, y precio del ítem en la cotización.
--
-- A) El chat ya no se oculta en el momento en que el trabajo cierra.
--    Se bloquea para escribir (cliente y profesional). La reseña sigue.
--    Con la reseña se usa el ocultado de siempre (hide_conversation_for_participants).
--    Sin reseña, a los 7 días de write_locked_at lo hace pg_cron.
--    No se bloquea ni se oculta si el par tiene otro trabajo vivo o un reclamo
--    abierto (#84). El hilo de un reclamo cerrado (#206) entra en la misma regla.
--
-- B) quote_items.variant_index 0 es el precio del ítem. 1..3 siguen siendo marcas.
--    Las cotizaciones ya guardadas no se reescriben.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS write_locked_at timestamptz;

COMMENT ON COLUMN public.conversations.write_locked_at IS
  'Inicio del bloqueo de escritura, cuando las dos conformidades ya están. La reseña elimina el chat; si no hay reseña, se elimina a los 7 días.';

ALTER TABLE public.quote_items DROP CONSTRAINT IF EXISTS quote_items_variant_index_chk;

ALTER TABLE public.quote_items
  ADD CONSTRAINT quote_items_variant_index_chk
  CHECK (variant_index BETWEEN 0 AND 3);

COMMENT ON COLUMN public.quote_items.variant_index IS
  'variant_index 0 = precio del ítem, sin marca. 1..3 = marcas. Una cotización vieja de un solo precio sigue en 1, con la etiqueta vacía.';

-- Misma condición que hide_pair_chats_if_done (20260929220000), ahora como predicado.
CREATE OR REPLACE FUNCTION public.chat_pair_ready(p_client uuid, p_worker uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.contrataciones ct
      WHERE ct.client_id = p_client
        AND ct.worker_id = p_worker
        AND (
          (
            ct.estado_trabajo = 'finalizado'
            AND ct.completed_by_worker_at IS NOT NULL
            AND ct.conformidad_aceptada IS TRUE
            AND ct.estado_pago = 'totalmente_pagado'
            AND NOT ct.is_claim_open
            AND ct.claim_status NOT IN ('open', 'pending_approval')
          )
          OR (
            ct.claim_opened_at IS NOT NULL
            AND ct.claim_marked_done_at IS NOT NULL
            AND ct.claim_resolved_at IS NOT NULL
            AND ct.is_claim_open = false
            AND ct.claim_status = 'closed'
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.contrataciones ct
      WHERE ct.client_id = p_client
        AND ct.worker_id = p_worker
        AND (
          ct.is_claim_open
          OR ct.claim_status IN ('open', 'pending_approval')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.contrataciones ct
      WHERE ct.client_id = p_client
        AND ct.worker_id = p_worker
        AND NOT (
          (
            ct.estado_trabajo = 'finalizado'
            AND ct.completed_by_worker_at IS NOT NULL
            AND ct.conformidad_aceptada IS TRUE
            AND ct.estado_pago = 'totalmente_pagado'
            AND NOT ct.is_claim_open
            AND ct.claim_status NOT IN ('open', 'pending_approval')
          )
          OR ct.estado_trabajo = 'cancelado'
          OR (
            ct.claim_opened_at IS NOT NULL
            AND ct.claim_marked_done_at IS NOT NULL
            AND ct.claim_resolved_at IS NOT NULL
            AND ct.is_claim_open = false
            AND ct.claim_status = 'closed'
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.conversation_should_write_lock(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  v_claim uuid;
  v_deleted timestamptz;
  v_row public.contrataciones%ROWTYPE;
BEGIN
  SELECT c.cliente_id, c.trabajador_id, c.contratacion_id, c.deleted_at
    INTO v_cliente, v_trabajador, v_claim, v_deleted
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN false;
  END IF;

  IF public.conversation_tiene_trabajo_vivo(p_conversation_id) THEN
    RETURN false;
  END IF;

  IF v_claim IS NOT NULL THEN
    SELECT * INTO v_row FROM public.contrataciones WHERE id = v_claim;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    RETURN v_row.claim_opened_at IS NOT NULL
      AND v_row.claim_marked_done_at IS NOT NULL
      AND v_row.claim_resolved_at IS NOT NULL
      AND v_row.is_claim_open = false
      AND v_row.claim_status = 'closed';
  END IF;

  RETURN public.chat_pair_ready(v_cliente, v_trabajador);
END;
$$;

-- Solo cuenta una reseña de ESTE chat: la fila de worker_reviews de esta
-- conversación, la del trabajo del hilo de reclamo (conversations.contratacion_id),
-- o la de un trabajo ya cerrado cuyo conversation_id es este chat.
-- Una reseña vieja del mismo par, en otro hilo, no cierra este.
CREATE OR REPLACE FUNCTION public.chat_has_closing_review(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations conv
    WHERE conv.id = p_conversation_id
      AND (
        EXISTS (
          SELECT 1
          FROM public.worker_reviews wr
          WHERE wr.conversation_id = conv.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.worker_reviews wr
          WHERE conv.contratacion_id IS NOT NULL
            AND wr.job_id = conv.contratacion_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.worker_reviews wr
          JOIN public.contrataciones ct ON ct.id = wr.job_id
          WHERE ct.conversation_id = conv.id
            AND (
              (
                ct.estado_trabajo = 'finalizado'
                AND ct.completed_by_worker_at IS NOT NULL
                AND ct.conformidad_aceptada IS TRUE
                AND ct.estado_pago = 'totalmente_pagado'
                AND NOT ct.is_claim_open
                AND ct.claim_status NOT IN ('open', 'pending_approval')
              )
              OR (
                ct.claim_opened_at IS NOT NULL
                AND ct.claim_marked_done_at IS NOT NULL
                AND ct.claim_resolved_at IS NOT NULL
                AND ct.is_claim_open = false
                AND ct.claim_status = 'closed'
              )
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.sync_conversation_chat_lock(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_at timestamptz;
  v_sender uuid;
BEGIN
  SELECT c.write_locked_at, c.trabajador_id
    INTO v_locked_at, v_sender
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public.conversation_should_write_lock(p_conversation_id) THEN
    UPDATE public.conversations
    SET write_locked_at = NULL
    WHERE id = p_conversation_id
      AND write_locked_at IS NOT NULL;
    RETURN;
  END IF;

  IF public.chat_has_closing_review(p_conversation_id) THEN
    PERFORM public.hide_conversation_for_participants(p_conversation_id);
    RETURN;
  END IF;

  UPDATE public.conversations
  SET write_locked_at = coalesce(write_locked_at, now())
  WHERE id = p_conversation_id
    AND deleted_at IS NULL;

  IF v_locked_at IS NULL AND v_sender IS NOT NULL THEN
    INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
    SELECT
      p_conversation_id,
      v_sender,
      'El chat quedó bloqueado. El cliente puede dejar una reseña. Si no la deja, la conversación se elimina a los 7 días.',
      'system',
      jsonb_build_object('event', 'chat_bloqueado_conformidad', 'audience', 'todos')
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND m.type = 'system'
        AND m.metadata->>'event' = 'chat_bloqueado_conformidad'
    );
  END IF;
END;
$$;

-- Ya no oculta al instante: bloquea, o oculta si la reseña ya está.
CREATE OR REPLACE FUNCTION public.hide_pair_chats_if_done(
  p_client uuid,
  p_worker uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conv.id
    FROM public.conversations conv
    WHERE conv.cliente_id = p_client
      AND conv.trabajador_id = p_worker
      AND conv.deleted_at IS NULL
  LOOP
    PERFORM public.sync_conversation_chat_lock(c.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_write_if_chat_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Los avisos del sistema (conformidad, bloqueo) siguen. El texto, la foto,
  -- la cotización y el pedido de materiales no.
  IF TG_TABLE_NAME = 'messages' AND coalesce(NEW.type, 'text') = 'system' THEN
    RETURN NEW;
  END IF;

  IF NEW.conversation_id IS NOT NULL
     AND public.conversation_should_write_lock(NEW.conversation_id) THEN
    RAISE EXCEPTION 'chat_bloqueado' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_reject_chat_locked ON public.messages;
CREATE TRIGGER trg_messages_reject_chat_locked
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_write_if_chat_locked();

DROP TRIGGER IF EXISTS trg_material_requests_reject_chat_locked ON public.material_requests;
CREATE TRIGGER trg_material_requests_reject_chat_locked
  BEFORE INSERT ON public.material_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_write_if_chat_locked();

DROP TRIGGER IF EXISTS trg_contrataciones_reject_chat_locked ON public.contrataciones;
CREATE TRIGGER trg_contrataciones_reject_chat_locked
  BEFORE INSERT ON public.contrataciones
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_write_if_chat_locked();

CREATE OR REPLACE FUNCTION public.sync_chat_lock_from_contratacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_worker uuid;
BEGIN
  v_client := coalesce(NEW.client_id, OLD.client_id);
  v_worker := coalesce(NEW.worker_id, OLD.worker_id);
  IF v_client IS NOT NULL AND v_worker IS NOT NULL THEN
    PERFORM public.hide_pair_chats_if_done(v_client, v_worker);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contrataciones_sync_chat_lock ON public.contrataciones;
CREATE TRIGGER trg_contrataciones_sync_chat_lock
  AFTER INSERT OR UPDATE OF
    estado_trabajo,
    estado_pago,
    conformidad_aceptada,
    completed_by_worker_at,
    is_claim_open,
    claim_status,
    claim_opened_at,
    claim_marked_done_at,
    claim_resolved_at
  ON public.contrataciones
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_chat_lock_from_contratacion();

-- La reseña sigue archivando con la función de siempre y, además, cierra
-- el hilo de reclamo del mismo par si ya estaba para bloquearse.
CREATE OR REPLACE FUNCTION public.on_worker_review_try_archive_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_worker uuid;
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    PERFORM public.try_archive_chat_after_job_complete(NEW.job_id);
    SELECT c.client_id, c.worker_id
      INTO v_client, v_worker
    FROM public.contrataciones c
    WHERE c.id = NEW.job_id;
  ELSIF NEW.conversation_id IS NOT NULL THEN
    PERFORM public.try_archive_chat_after_job_complete(
      (
        SELECT c.id
        FROM public.contrataciones c
        WHERE c.conversation_id = NEW.conversation_id
          AND c.estado_pago = 'totalmente_pagado'
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 1
      )
    );
    SELECT conv.cliente_id, conv.trabajador_id
      INTO v_client, v_worker
    FROM public.conversations conv
    WHERE conv.id = NEW.conversation_id;
  END IF;

  IF v_client IS NOT NULL AND v_worker IS NOT NULL THEN
    PERFORM public.hide_pair_chats_if_done(v_client, v_worker);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_locked_chats_without_review()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_n integer := 0;
BEGIN
  FOR c IN
    SELECT conv.id
    FROM public.conversations conv
    WHERE conv.deleted_at IS NULL
      AND conv.write_locked_at IS NOT NULL
      AND conv.write_locked_at <= now() - interval '7 days'
  LOOP
    IF public.conversation_should_write_lock(c.id)
       AND NOT public.chat_has_closing_review(c.id) THEN
      PERFORM public.hide_conversation_for_participants(c.id);
      v_n := v_n + 1;
    ELSE
      PERFORM public.sync_conversation_chat_lock(c.id);
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_pair_ready(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_pair_ready(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_pair_ready(uuid, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.conversation_should_write_lock(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.conversation_should_write_lock(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.conversation_should_write_lock(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.chat_has_closing_review(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_has_closing_review(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.chat_has_closing_review(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.sync_conversation_chat_lock(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_conversation_chat_lock(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_conversation_chat_lock(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.reject_write_if_chat_locked() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_write_if_chat_locked() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_write_if_chat_locked() FROM authenticated;

REVOKE ALL ON FUNCTION public.sync_chat_lock_from_contratacion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_chat_lock_from_contratacion() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_chat_lock_from_contratacion() FROM authenticated;

REVOKE ALL ON FUNCTION public.on_worker_review_try_archive_chat() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_worker_review_try_archive_chat() FROM anon;
REVOKE EXECUTE ON FUNCTION public.on_worker_review_try_archive_chat() FROM authenticated;

REVOKE ALL ON FUNCTION public.purge_locked_chats_without_review() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_locked_chats_without_review() FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_locked_chats_without_review() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.purge_locked_chats_without_review() TO service_role;

COMMENT ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) IS
  'Bloquea el chat del par cuando las dos conformidades están y no queda un trabajo vivo ni un reclamo abierto. Si ya hay reseña, lo oculta. Sin reseña, write_locked_at cuenta 7 días.';

COMMENT ON FUNCTION public.purge_locked_chats_without_review() IS
  'Oculta los chats bloqueados hace más de 7 días si el cliente no dejó reseña. No toca un hilo que volvió a tener trabajo vivo o reclamo abierto.';

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Mismo patrón que storage_orphan_cleanup_weekly: si el job ya existe se
-- baja y se vuelve a crear. Corre como postgres, igual que el resto.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat_bloqueado_sin_resena_7d') THEN
    PERFORM cron.unschedule('chat_bloqueado_sin_resena_7d');
  END IF;
  PERFORM cron.schedule(
    'chat_bloqueado_sin_resena_7d',
    '*/15 * * * *',
    $cmd$SELECT public.purge_locked_chats_without_review();$cmd$
  );
  UPDATE cron.job
  SET username = 'postgres'
  WHERE jobname = 'chat_bloqueado_sin_resena_7d';
END;
$cron$;
