-- Reclamo de garantía desde Trabajos contratados.
-- El cliente lo inicia mientras quedan días. No cambia estado_trabajo
-- ni warranty_anchor_at: el plazo sigue corriendo.
--
-- Chat:
--   * Si el hilo ya es de esta contratación (contratacion_id) y está activo, se usa.
--   * Si el hilo activo es solo de este trabajo y no tiene avisos de otro reclamo, se usa.
--   * Si lo comparte otro trabajo, o ya tiene un reclamo de otra contratación,
--     se crea un chat propio (conversations.contratacion_id) y no se mezcla.
--   * El índice único del par queda para el hilo general (contratacion_id NULL).
--     Cada contratación puede tener su hilo de reclamo activo.
--   * No se cierra un chat de un trabajo en curso ni de un reclamo abierto o pendiente.
--   * El aviso nombra el servicio y la fecha cuando el reclamo abre hilo propio.
--   * Repetir el RPC no vuelve a insertar el evento en el mismo chat.
-- DROP primero: Postgres no deja cambiar el tipo de retorno con CREATE OR REPLACE.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS contratacion_id uuid;

COMMENT ON COLUMN public.conversations.contratacion_id IS
  'Hilo de reclamo de esta contratación. NULL es el chat general del par cliente/profesional.';

DROP INDEX IF EXISTS ux_conversations_active_pair;
DROP INDEX IF EXISTS ux_conversations_active_contratacion;

CREATE UNIQUE INDEX ux_conversations_active_pair
  ON public.conversations (cliente_id, trabajador_id)
  WHERE deleted_at IS NULL AND contratacion_id IS NULL;

CREATE UNIQUE INDEX ux_conversations_active_contratacion
  ON public.conversations (contratacion_id)
  WHERE deleted_at IS NULL AND contratacion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.conversation_tiene_trabajo_vivo(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contrataciones ct
    WHERE ct.conversation_id = p_conversation_id
      AND (
        (
          ct.estado_trabajo IS DISTINCT FROM 'finalizado'
          AND ct.estado_trabajo IS DISTINCT FROM 'cancelado'
          AND ct.estado_trabajo IS DISTINCT FROM 'disputa'
        )
        OR ct.is_claim_open
        OR ct.claim_status IN ('open', 'pending_approval')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.conversation_tiene_trabajo_vivo(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.conversation_tiene_trabajo_vivo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.conversation_tiene_trabajo_vivo(uuid) TO service_role;

-- Cuerpo de producción (worker_not_found / worker_on_leave / worker_unavailable)
-- más dos filtros: el hilo general es contratacion_id IS NULL, y no se cierra
-- un hilo con trabajo en curso o reclamo abierto.
CREATE OR REPLACE FUNCTION public.find_or_create_conversation(
  p_trabajador_id uuid,
  p_primary_trade text DEFAULT ''
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
  v_worker_status text;
  r record;
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
    AND c.deleted_at IS NULL
    AND c.contratacion_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_hides h
      WHERE h.conversation_id = c.id
    )
  ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    FOR r IN
      SELECT c.id
      FROM public.conversations c
      WHERE c.cliente_id = v_cliente_id
        AND c.trabajador_id = p_trabajador_id
        AND c.deleted_at IS NULL
        AND c.id <> v_id
        AND c.contratacion_id IS NULL
        AND NOT public.conversation_tiene_trabajo_vivo(c.id)
    LOOP
      PERFORM public.hide_conversation_for_participants(r.id);
    END LOOP;
    RETURN v_id;
  END IF;

  SELECT coalesce(p.professional_status, 'none')
  INTO v_worker_status
  FROM public.profiles p
  WHERE p.id = p_trabajador_id;

  IF v_worker_status IS NULL THEN
    RAISE EXCEPTION 'worker_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_worker_status = 'paused' THEN
    RAISE EXCEPTION 'worker_on_leave' USING ERRCODE = 'P0001';
  END IF;

  IF v_worker_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'worker_unavailable' USING ERRCODE = 'P0001';
  END IF;

  FOR r IN
    SELECT c.id
    FROM public.conversations c
    WHERE c.cliente_id = v_cliente_id
      AND c.trabajador_id = p_trabajador_id
      AND c.deleted_at IS NULL
      AND c.contratacion_id IS NULL
      AND NOT public.conversation_tiene_trabajo_vivo(c.id)
  LOOP
    PERFORM public.hide_conversation_for_participants(r.id);
  END LOOP;

  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.cliente_id = v_cliente_id
    AND c.trabajador_id = p_trabajador_id
    AND c.deleted_at IS NULL
    AND c.contratacion_id IS NULL
  ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
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

REVOKE ALL ON FUNCTION public.find_or_create_conversation(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.iniciar_reclamo_garantia(uuid);

CREATE FUNCTION public.iniciar_reclamo_garantia(p_contratacion_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_anchor timestamptz;
  v_already boolean;
  v_conv_id uuid;
  v_own_id uuid;
  v_own_deleted timestamptz;
  v_own_contratacion uuid;
  v_cliente uuid;
  v_trabajador uuid;
  v_active uuid;
  v_trade text;
  v_shared boolean := false;
  v_foreign_msgs boolean := false;
  v_dedicated boolean := false;
  v_can_close boolean := false;
  v_on_other_chat boolean := false;
  v_servicio text;
  v_fecha text;
  v_body text;
  v_event_here boolean;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede iniciar el reclamo de garantía';
  END IF;

  IF v_row.estado_trabajo IN ('cancelado', 'disputa') THEN
    RAISE EXCEPTION 'Este trabajo no admite un reclamo de garantía';
  END IF;

  IF v_row.estado_trabajo <> 'finalizado' THEN
    RAISE EXCEPTION 'El reclamo se inicia cuando el trabajo está finalizado';
  END IF;

  IF coalesce(v_row.warranty_days, 0) <= 0 THEN
    RAISE EXCEPTION 'Este trabajo no incluye garantía';
  END IF;

  v_anchor := coalesce(v_row.warranty_anchor_at, v_row.finalizado_at, v_row.completed_by_worker_at);
  IF v_anchor IS NULL
     OR v_anchor + make_interval(days => v_row.warranty_days) <= now() THEN
    RAISE EXCEPTION 'La garantía ya venció';
  END IF;

  v_already := v_row.is_claim_open
    AND v_row.claim_status IN ('open', 'pending_approval');

  IF NOT v_already THEN
    UPDATE public.contrataciones
    SET
      is_claim_open = true,
      claim_status = 'open',
      claim_opened_at = now(),
      claim_marked_done_at = NULL,
      claim_resolved_at = NULL
    WHERE id = p_contratacion_id;
  END IF;

  v_cliente := v_row.client_id;
  v_trabajador := v_row.worker_id;
  v_own_id := v_row.conversation_id;

  IF v_own_id IS NOT NULL THEN
    SELECT c.deleted_at, c.primary_trade, c.contratacion_id
      INTO v_own_deleted, v_trade, v_own_contratacion
    FROM public.conversations c
    WHERE c.id = v_own_id
      AND c.cliente_id = v_cliente
      AND c.trabajador_id = v_trabajador;

    IF NOT FOUND THEN
      v_own_id := NULL;
      v_own_deleted := NULL;
      v_trade := NULL;
      v_own_contratacion := NULL;
    END IF;
  END IF;

  IF v_own_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.contrataciones ct
      WHERE ct.conversation_id = v_own_id
        AND ct.id <> p_contratacion_id
    )
    INTO v_shared;

    SELECT EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.conversation_id = v_own_id
        AND coalesce(m.metadata->>'contratacion_id', '') <> ''
        AND m.metadata->>'contratacion_id' IS DISTINCT FROM p_contratacion_id::text
    )
    INTO v_foreign_msgs;
  END IF;

  -- NULL = uuid no es false: si contratacion_id está vacío hay que tratarlo como no dedicado.
  v_dedicated := v_own_id IS NOT NULL
    AND v_own_deleted IS NULL
    AND (
      (v_own_contratacion IS NOT NULL AND v_own_contratacion = p_contratacion_id)
      OR (NOT v_shared AND NOT v_foreign_msgs)
    );

  IF NOT v_dedicated THEN
    SELECT c.id
      INTO v_active
    FROM public.conversations c
    WHERE c.cliente_id = v_cliente
      AND c.trabajador_id = v_trabajador
      AND c.deleted_at IS NULL
      AND c.contratacion_id IS NULL
    ORDER BY c.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_active IS NOT NULL AND v_active IS DISTINCT FROM v_own_id THEN
      SELECT
        EXISTS (
          SELECT 1
          FROM public.contrataciones ct
          WHERE ct.conversation_id = v_active
            AND ct.id <> p_contratacion_id
            AND ct.estado_trabajo = 'finalizado'
            AND NOT ct.is_claim_open
            AND ct.claim_status NOT IN ('open', 'pending_approval')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.contrataciones ct
          WHERE ct.conversation_id = v_active
            AND ct.id <> p_contratacion_id
            AND (
              ct.estado_trabajo IS DISTINCT FROM 'finalizado'
              OR ct.is_claim_open
              OR ct.claim_status IN ('open', 'pending_approval')
            )
        )
      INTO v_can_close;
    END IF;

    IF v_active IS NOT NULL AND v_active IS DISTINCT FROM v_own_id AND v_can_close THEN
      PERFORM public.hide_conversation_for_participants(v_active);
    END IF;

    INSERT INTO public.conversations (cliente_id, trabajador_id, primary_trade, contratacion_id, updated_at)
    VALUES (v_cliente, v_trabajador, v_trade, p_contratacion_id, now())
    RETURNING id INTO v_conv_id;

    v_on_other_chat := true;
  ELSE
    v_conv_id := v_own_id;
  END IF;

  UPDATE public.conversations
  SET contratacion_id = p_contratacion_id, updated_at = now()
  WHERE id = v_conv_id
    AND contratacion_id IS DISTINCT FROM p_contratacion_id;

  UPDATE public.contrataciones
  SET conversation_id = v_conv_id
  WHERE id = p_contratacion_id
    AND conversation_id IS DISTINCT FROM v_conv_id;

  -- El hilo general compartido se queda con su historial. No se oculta
  -- porque las contrataciones pasaron a un chat de reclamo propio.

  DELETE FROM public.conversation_hides
  WHERE conversation_id = v_conv_id
    AND user_id IN (v_cliente, v_trabajador);

  SELECT EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.conversation_id = v_conv_id
      AND coalesce(m.metadata->>'event', '') = 'reclamo_garantia_iniciado'
      AND coalesce(m.metadata->>'contratacion_id', '') = p_contratacion_id::text
  )
  INTO v_event_here;

  IF NOT v_already OR NOT v_event_here THEN
    v_body := 'El cliente inició un reclamo de garantía. Coordinen la revisión por este chat. La garantía sigue su curso.';

    IF v_on_other_chat THEN
      v_servicio := nullif(btrim(coalesce(v_row.service_detail, '')), '');
      v_fecha := to_char(
        coalesce(
          v_row.fecha_trabajo,
          (v_row.finalizado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
          (v_row.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        ),
        'DD/MM/YYYY'
      );

      IF v_servicio IS NOT NULL AND coalesce(v_fecha, '') <> '' THEN
        v_body := 'El cliente inició un reclamo de garantía por «'
          || v_servicio
          || '» del '
          || v_fecha
          || '. Coordinen la revisión por este chat. La garantía sigue su curso.';
      ELSIF v_servicio IS NOT NULL THEN
        v_body := 'El cliente inició un reclamo de garantía por «'
          || v_servicio
          || '». Coordinen la revisión por este chat. La garantía sigue su curso.';
      ELSIF coalesce(v_fecha, '') <> '' THEN
        v_body := 'El cliente inició un reclamo de garantía del '
          || v_fecha
          || '. Coordinen la revisión por este chat. La garantía sigue su curso.';
      END IF;
    END IF;

    PERFORM public._chat_insert_system_event(
      v_conv_id,
      auth.uid(),
      v_body,
      jsonb_build_object(
        'event', 'reclamo_garantia_iniciado',
        'contratacion_id', p_contratacion_id,
        'audience', 'todos'
      )
    );
  END IF;

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.iniciar_reclamo_garantia(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.iniciar_reclamo_garantia(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.iniciar_reclamo_garantia(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.iniciar_reclamo_garantia(uuid) IS
  'El cliente abre o vuelve a un reclamo de garantía en el chat de esa contratación. Si el hilo está compartido, crea uno propio y no oculta el chat de otro trabajo en curso o con reclamo abierto.';

-- Cuerpo de producción de crear_cotizacion, más el rechazo de un hilo de reclamo
-- (contratacion_id NOT NULL). Va después del ADD COLUMN de esta migración.
CREATE OR REPLACE FUNCTION public.crear_cotizacion(
  p_conversation_id uuid,
  p_precio_trabajador numeric,
  p_service_detail text DEFAULT '',
  p_warranty_days integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations%rowtype;
  v_precios record;
  v_id uuid;
  v_detail text;
  v_neto numeric;
  v_warranty_days integer;
BEGIN
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
$$;

REVOKE ALL ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.crear_cotizacion(uuid, numeric, text, integer) TO authenticated, service_role;
