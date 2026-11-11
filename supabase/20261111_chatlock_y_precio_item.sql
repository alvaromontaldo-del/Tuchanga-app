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

-- Helper: el chat no admite cotizar, editar, recotizar ni agenda.
-- Cuerpos de abajo: pg_get_functiondef vivo (2026-11-11), con esta llamada al inicio.
CREATE OR REPLACE FUNCTION public.assert_chat_not_write_locked(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_conversation_id IS NULL THEN
    RETURN;
  END IF;
  IF public.conversation_should_write_lock(p_conversation_id)
     OR EXISTS (
       SELECT 1
       FROM public.conversations c
       WHERE c.id = p_conversation_id
         AND c.write_locked_at IS NOT NULL
     )
  THEN
    RAISE EXCEPTION 'chat_bloqueado' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_chat_not_write_locked(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_chat_not_write_locked(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_chat_not_write_locked(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.crear_cotizacion(p_conversation_id uuid, p_precio_trabajador numeric, p_service_detail text DEFAULT ''::text, p_warranty_days integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv public.conversations%rowtype;
  v_precios record;
  v_id uuid;
  v_detail text;
  v_neto numeric;
  v_warranty_days integer;
BEGIN
  PERFORM public.assert_chat_not_write_locked(p_conversation_id);

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversación inexistente';
  END IF;

  IF v_conv.trabajador_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede cotizar';
  END IF;

  IF v_conv.contratacion_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede cotizar en un chat de reclamo' USING ERRCODE = 'P0001';
  END IF;

  v_detail := coalesce(trim(p_service_detail), '');
  IF v_detail = '' THEN
    RAISE EXCEPTION 'El detalle del servicio es obligatorio';
  END IF;

  IF p_warranty_days IS NULL OR p_warranty_days <= 0 THEN
    v_warranty_days := NULL;
  ELSIF p_warranty_days > 60 THEN
    RAISE EXCEPTION 'Los días de garantía deben ser entre 1 y 60';
  ELSE
    v_warranty_days := p_warranty_days;
  END IF;

  PERFORM public._assert_sin_contratacion_activa(p_conversation_id);

  v_neto := ceil(p_precio_trabajador);
  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);

  INSERT INTO public.contrataciones (
    conversation_id,
    worker_id,
    client_id,
    precio_trabajador,
    precio_final,
    comision_app,
    service_detail,
    estado_trabajo,
    estado_pago,
    warranty_days
  )
  VALUES (
    p_conversation_id,
    v_conv.trabajador_id,
    v_conv.cliente_id,
    v_neto,
    v_precios.precio_final,
    v_precios.comision_app,
    v_detail,
    'precio_cotizado',
    'pendiente_seña',
    v_warranty_days
  )
  RETURNING id INTO v_id;

  INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
  VALUES (
    p_conversation_id,
    auth.uid(),
    v_detail,
    'quotation',
    jsonb_build_object(
      'contratacion_id', v_id,
      'precio_final', v_precios.precio_final,
      'precio_trabajador', v_neto,
      'service_detail', v_detail,
      'warranty_days', v_warranty_days
    )
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.editar_cotizacion(p_contratacion_id uuid, p_precio_trabajador numeric, p_service_detail text DEFAULT ''::text, p_warranty_days integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_precios record;
  v_detail text;
  v_neto numeric;
  v_warranty_days integer;
BEGIN
  PERFORM public.assert_chat_not_write_locked(
    (SELECT c.conversation_id FROM public.contrataciones c WHERE c.id = p_contratacion_id)
  );

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización inexistente';
  END IF;

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede editar la cotización' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'precio_cotizado' THEN
    RAISE EXCEPTION 'Solo se puede editar un presupuesto pendiente';
  END IF;

  v_detail := coalesce(trim(p_service_detail), '');
  IF v_detail = '' THEN
    RAISE EXCEPTION 'El detalle del servicio es obligatorio';
  END IF;

  IF p_warranty_days IS NULL OR p_warranty_days <= 0 THEN
    v_warranty_days := NULL;
  ELSIF p_warranty_days > 60 THEN
    RAISE EXCEPTION 'Los días de garantía deben ser entre 1 y 60';
  ELSE
    v_warranty_days := p_warranty_days;
  END IF;

  v_neto := ceil(p_precio_trabajador);
  IF v_neto IS NULL OR v_neto <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);

  UPDATE public.contrataciones
  SET
    precio_trabajador = v_neto,
    precio_final = v_precios.precio_final,
    comision_app = v_precios.comision_app,
    service_detail = v_detail,
    warranty_days = v_warranty_days
  WHERE id = p_contratacion_id;

  -- La tarjeta del chat. No es un mensaje nuevo y no nombra el costo de servicio.
  UPDATE public.messages
  SET
    body = v_detail,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'contratacion_id', p_contratacion_id,
      'precio_final', v_precios.precio_final,
      'precio_trabajador', v_neto,
      'service_detail', v_detail,
      'warranty_days', v_warranty_days
    )
  WHERE conversation_id = v_row.conversation_id
    AND type = 'quotation'
    AND coalesce(metadata->>'kind', '') IS DISTINCT FROM 'material_quote'
    AND (
      metadata->>'contratacion_id' = p_contratacion_id::text
      OR metadata->>'quoteId' = p_contratacion_id::text
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recotizar_en_curso(p_contratacion_id uuid, p_nuevo_precio_trabajador numeric, p_fundamentos text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_precios record;
  v_pagado numeric;
  v_comision numeric;
  v_precio_final numeric;
  v_neto numeric;
  v_fundamentos text;
  v_id uuid;
  v_monto_txt text;
BEGIN
  PERFORM public.assert_chat_not_write_locked(
    (SELECT c.conversation_id FROM public.contrataciones c WHERE c.id = p_contratacion_id)
  );

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_row := public._assert_contratacion_participante(p_contratacion_id);

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede recotizar' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'en_curso' THEN
    RAISE EXCEPTION 'Solo se puede recotizar con trabajo en curso';
  END IF;

  -- Falta acreditar la diferencia de la recotización anterior. Si se dejara
  -- proponer otra, el pago de esa diferencia (registrar_seña_aprobada) limpiaría
  -- la propuesta nueva a medias.
  IF v_row.estado_pago = 'pendiente_seña' THEN
    RAISE EXCEPTION 'Falta que el cliente pague la diferencia del costo de servicio';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pin_intentos
    WHERE contratacion_id = p_contratacion_id
      AND actor_id = auth.uid()
      AND exito = true
  ) THEN
    RAISE EXCEPTION 'Tenés que validar el PIN del cliente antes de recotizar';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.recotizaciones
    WHERE contratacion_id = p_contratacion_id
      AND estado = 'pendiente'
  ) OR v_row.recotizacion_precio_trabajador IS NOT NULL THEN
    RAISE EXCEPTION 'Ya hay una recotización pendiente';
  END IF;

  v_fundamentos := btrim(coalesce(p_fundamentos, ''));
  IF char_length(v_fundamentos) < 10 OR char_length(v_fundamentos) > 1000 THEN
    RAISE EXCEPTION 'Los fundamentos son obligatorios';
  END IF;

  IF p_nuevo_precio_trabajador IS NULL OR p_nuevo_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;

  v_neto := ceil(p_nuevo_precio_trabajador);
  IF v_neto = ceil(v_row.precio_trabajador) THEN
    RAISE EXCEPTION 'El monto nuevo tiene que ser distinto del actual';
  END IF;

  -- #39: calc_precios_contratacion usa calc_yachanga_service_fee.
  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);
  v_comision := v_precios.comision_app;
  v_precio_final := v_precios.precio_final;

  SELECT coalesce(sum(monto), 0) INTO v_pagado
  FROM public.transacciones_pago
  WHERE contratacion_id = p_contratacion_id
    AND estado_mp = 'approved'
    AND tipo_pago IN ('seña_inicial', 'diferencia_seña');
  IF v_row.estado_pago IN ('seña_pagada', 'totalmente_pagado') THEN
    v_pagado := greatest(v_pagado, v_row.comision_app);
  END IF;

  -- #4 opción A: el cliente no paga nada más, ni la diferencia del costo de
  -- servicio. #39 sigue vigente: tampoco hay devolución. La comisión queda
  -- en lo ya pagado aunque el tramo nuevo sea más alto.
  v_precio_final := v_precio_final - v_comision + v_pagado;
  v_comision := v_pagado;

  INSERT INTO public.recotizaciones (
    contratacion_id,
    worker_id,
    client_id,
    precio_trabajador_anterior,
    precio_final_anterior,
    comision_app_anterior,
    precio_trabajador_nuevo,
    precio_final_nuevo,
    comision_app_nuevo,
    fundamentos,
    estado
  )
  VALUES (
    p_contratacion_id,
    v_row.worker_id,
    v_row.client_id,
    v_row.precio_trabajador,
    v_row.precio_final,
    v_row.comision_app,
    v_neto,
    v_precio_final,
    v_comision,
    v_fundamentos,
    'pendiente'
  )
  RETURNING id, fundamentos INTO v_id, v_fundamentos;

  UPDATE public.contrataciones
  SET
    recotizacion_id = v_id,
    recotizacion_fundamentos = v_fundamentos,
    recotizacion_precio_trabajador = v_neto,
    recotizacion_precio_final = v_precio_final,
    recotizacion_comision_app = v_comision,
    estado_trabajo = 'pendiente_pago_diferencia'
  WHERE id = p_contratacion_id;

  v_monto_txt := '$' || regexp_replace(trunc(v_neto)::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional propone un nuevo monto para el trabajo.' || E'\n'
      || 'Pago al profesional: ' || v_monto_txt || E'\n'
      || 'Fundamentos: ' || v_fundamentos,
    jsonb_build_object(
      'event', 'recotizacion_propuesta',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_id,
      'audience', 'cliente',
      'fundamentos', v_fundamentos,
      'precio_trabajador_anterior', v_row.precio_trabajador,
      'precio_trabajador', v_neto,
      'precio_final', v_precio_final,
      'comision_app', v_comision
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Enviaste una recotización de ' || v_monto_txt || '.' || E'\n'
      || 'Fundamentos: ' || v_fundamentos || E'\n'
      || 'El cliente tiene que aceptarla o rechazarla.',
    jsonb_build_object(
      'event', 'recotizacion_propuesta_trabajador',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_id,
      'audience', 'trabajador',
      'fundamentos', v_fundamentos,
      'precio_trabajador_anterior', v_row.precio_trabajador,
      'precio_trabajador', v_neto
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) TO authenticated, service_role;

-- proponer_disponibilidad(uuid, date, time, time) vivo solo delega en esta función.
CREATE OR REPLACE FUNCTION public.proponer_disponibilidad_opciones(p_contratacion_id uuid, p_opciones jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_count int;
  v_lote int;
  v_opcion jsonb;
  v_fecha date;
  v_ini time;
  v_fin time;
  v_body text := '';
  v_n int := 0;
  v_claim boolean := false;
  v_conf_fecha date;
  v_conf_ini text;
  v_conf_fin text;
BEGIN
  PERFORM public.assert_chat_not_write_locked(
    (SELECT c.conversation_id FROM public.contrataciones c WHERE c.id = p_contratacion_id)
  );

  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede proponer disponibilidad';
  END IF;

  v_claim := (
    v_row.estado_trabajo = 'finalizado'
    AND v_row.is_claim_open
    AND v_row.claim_status IN ('open', 'pending_approval')
  );

  IF v_row.estado_trabajo <> 'precio_aceptado' AND NOT v_claim THEN
    RAISE EXCEPTION 'Estado inválido para proponer disponibilidad';
  END IF;

  IF p_opciones IS NULL OR jsonb_typeof(p_opciones) <> 'array' THEN
    RAISE EXCEPTION 'Opciones inválidas';
  END IF;

  v_count := jsonb_array_length(p_opciones);
  IF v_count < 1 OR v_count > 5 THEN
    RAISE EXCEPTION 'Debés enviar entre 1 y 5 opciones';
  END IF;

  -- #43. Misma llave que _agenda_lock_worker: serializa con aceptar y reagendar.
  PERFORM public._agenda_lock_worker(v_row.worker_id);

  UPDATE public.disponibilidad_opciones
  SET estado = 'descartada'
  WHERE contratacion_id = p_contratacion_id
    AND estado = 'propuesta';

  SELECT coalesce(max(lote), 0) + 1 INTO v_lote
  FROM public.disponibilidad_opciones
  WHERE contratacion_id = p_contratacion_id;

  FOR v_opcion IN SELECT value FROM jsonb_array_elements(p_opciones)
  LOOP
    v_fecha := (v_opcion->>'fecha')::date;
    v_ini := (v_opcion->>'hora_inicio')::time;
    v_fin := (v_opcion->>'hora_fin')::time;

    IF v_fecha IS NULL OR v_ini IS NULL OR v_fin IS NULL OR v_fin <= v_ini THEN
      RAISE EXCEPTION 'Cada opción debe tener fecha y horario válidos';
    END IF;

    -- #43. Antes del INSERT. Si falla, el UPDATE de arriba hace rollback.
    SELECT s.fecha_trabajo, s.hora_inicio, s.hora_fin
    INTO v_conf_fecha, v_conf_ini, v_conf_fin
    FROM public._agenda_conflicting_busy_slot(
      v_row.worker_id,
      p_contratacion_id,
      v_fecha,
      v_ini,
      v_fin
    ) AS s;

    IF v_conf_fecha IS NOT NULL THEN
      RAISE EXCEPTION 'slot_overlap'
        USING
          ERRCODE = 'P0001',
          DETAIL = format(
            'fecha=%s;hora_inicio=%s;hora_fin=%s;opcion_index=%s',
            to_char(v_conf_fecha, 'YYYY-MM-DD'),
            v_conf_ini,
            v_conf_fin,
            v_n
          );
    END IF;

    INSERT INTO public.disponibilidad_opciones (
      contratacion_id, lote, fecha_trabajo, hora_inicio, hora_fin, estado
    )
    VALUES (p_contratacion_id, v_lote, v_fecha, v_ini, v_fin, 'propuesta');

    v_n := v_n + 1;
    v_body := v_body || v_n::text || ') '
      || to_char(v_fecha, 'DD/MM/YYYY') || ' '
      || to_char(v_ini, 'HH24:MI') || '–' || to_char(v_fin, 'HH24:MI') || E'\n';
  END LOOP;

  UPDATE public.contrataciones
  SET
    fecha_trabajo = NULL,
    hora_inicio = NULL,
    hora_fin = NULL
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    CASE
      WHEN v_claim THEN
        '📅 (Garantía) Propongo estos horarios para la revisión:' || E'\n' || trim(v_body)
      ELSE
        '📅 Propongo estos horarios (elegí uno o rechazá todos):' || E'\n' || trim(v_body)
    END,
    jsonb_build_object(
      'event', 'disponibilidad_propuesta',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente',
      'lote', v_lote,
      'opciones_count', v_count
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.proponer_disponibilidad_opciones(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.proponer_disponibilidad_opciones(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.proponer_disponibilidad_opciones(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.proponer_reagendar_visita(p_contratacion_id uuid, p_opciones jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_count int;
  v_lote int;
  v_opcion jsonb;
  v_fecha date;
  v_ini time;
  v_fin time;
  v_body text := '';
  v_n int := 0;
  v_first_fecha date;
  v_first_ini time;
  v_first_fin time;
  v_opc_id uuid;
  v_exclude uuid[];
BEGIN
  PERFORM public.assert_chat_not_write_locked(
    (SELECT c.conversation_id FROM public.contrataciones c WHERE c.id = p_contratacion_id)
  );

  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede proponer reagendar';
  END IF;

  IF v_row.estado_trabajo NOT IN ('aceptado', 'en_curso') THEN
    RAISE EXCEPTION 'Solo se puede reagendar con agenda confirmada o trabajo en curso';
  END IF;

  IF v_row.fecha_trabajo IS NULL OR v_row.hora_inicio IS NULL OR v_row.hora_fin IS NULL THEN
    RAISE EXCEPTION 'No hay horario oficial para reagendar';
  END IF;

  IF p_opciones IS NULL OR jsonb_typeof(p_opciones) <> 'array' THEN
    RAISE EXCEPTION 'Opciones inválidas';
  END IF;

  v_count := jsonb_array_length(p_opciones);
  IF v_count < 1 OR v_count > 5 THEN
    RAISE EXCEPTION 'Debés enviar entre 1 y 5 opciones';
  END IF;

  PERFORM public._agenda_lock_worker(v_row.worker_id);

  -- Asegurar bloque reserved de la fecha oficial
  PERFORM public._agenda_ensure_reserved(p_contratacion_id);

  -- Liberar tentatives previos de este trabajo
  PERFORM public._agenda_free_blocks(p_contratacion_id, ARRAY['tentative']::text[]);

  UPDATE public.disponibilidad_opciones
  SET estado = 'descartada'
  WHERE contratacion_id = p_contratacion_id
    AND estado = 'propuesta';

  SELECT coalesce(max(lote), 0) + 1 INTO v_lote
  FROM public.disponibilidad_opciones
  WHERE contratacion_id = p_contratacion_id;

  -- Excluir el reserved oficial de este trabajo al chequear solapes
  SELECT coalesce(array_agg(b.id), ARRAY[]::uuid[])
  INTO v_exclude
  FROM public.professional_agenda_blocks b
  WHERE b.contratacion_id = p_contratacion_id
    AND b.status = 'reserved';

  FOR v_opcion IN SELECT value FROM jsonb_array_elements(p_opciones)
  LOOP
    v_fecha := (v_opcion->>'fecha')::date;
    v_ini := (v_opcion->>'hora_inicio')::time;
    v_fin := (v_opcion->>'hora_fin')::time;

    IF v_fecha IS NULL OR v_ini IS NULL OR v_fin IS NULL OR v_fin <= v_ini THEN
      RAISE EXCEPTION 'Cada opción debe tener fecha y horario válidos';
    END IF;

    IF public._agenda_slot_overlaps(v_row.worker_id, v_fecha, v_ini, v_fin, v_exclude) THEN
      RAISE EXCEPTION 'El horario % %–% se solapa con otra reserva de la agenda',
        to_char(v_fecha, 'DD/MM/YYYY'),
        to_char(v_ini, 'HH24:MI'),
        to_char(v_fin, 'HH24:MI');
    END IF;

    INSERT INTO public.disponibilidad_opciones (
      contratacion_id, lote, fecha_trabajo, hora_inicio, hora_fin, estado
    )
    VALUES (p_contratacion_id, v_lote, v_fecha, v_ini, v_fin, 'propuesta')
    RETURNING id INTO v_opc_id;

    INSERT INTO public.professional_agenda_blocks (
      worker_id, contratacion_id, disponibilidad_opcion_id,
      fecha_trabajo, hora_inicio, hora_fin, status
    )
    VALUES (
      v_row.worker_id, p_contratacion_id, v_opc_id,
      v_fecha, v_ini, v_fin, 'tentative'
    );

    v_n := v_n + 1;
    IF v_n = 1 THEN
      v_first_fecha := v_fecha;
      v_first_ini := v_ini;
      v_first_fin := v_fin;
    END IF;

    v_body := v_body || v_n::text || ') '
      || to_char(v_fecha, 'DD/MM/YYYY') || ' '
      || to_char(v_ini, 'HH24:MI') || '–' || to_char(v_fin, 'HH24:MI') || E'\n';
  END LOOP;

  -- Mantener fecha oficial; solo marcar propuesta pendiente
  UPDATE public.contrataciones
  SET
    reschedule_status = 'pending_approval',
    proposed_fecha_trabajo = v_first_fecha,
    proposed_hora_inicio = v_first_ini,
    proposed_hora_fin = v_first_fin,
    proposed_datetime = public._proposed_datetime_at(v_first_fecha, v_first_ini),
    updated_at = now()
  WHERE id = p_contratacion_id;

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '🔄 Propongo reagendar la visita (elegí una opción o rechazá):' || E'\n' || trim(v_body)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.proponer_reagendar_visita(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.proponer_reagendar_visita(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.proponer_reagendar_visita(uuid, jsonb) TO authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Si el job ya existe se baja y se vuelve a crear. cron.schedule queda
-- con el usuario de la sesión (postgres en el SQL editor), como el resto.
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
END;
$cron$;
