-- Reclamo de garantía desde Trabajos contratados.
-- El cliente lo inicia mientras quedan días. No cambia estado_trabajo
-- ni warranty_anchor_at: el plazo sigue corriendo.
--
-- Chat (misma decisión que resolveWarrantyClaimChat):
--   * Si el chat propio existe y está activo, se usa ese.
--   * Si conversation_id es NULL o el chat está borrado, no se reabre a
--     costa de otro trabajo. El chat activo del par solo se cierra cuando
--     su trabajo está finalizado y no tiene reclamo abierto ni pendiente;
--     en ese caso se crea un chat nuevo. Si no se puede cerrar, el evento
--     va a ese chat activo y el texto nombra el servicio y la fecha.
--   * Si no hay chat activo, se crea uno nuevo.
--   * El id elegido se guarda en contrataciones.conversation_id.
--   * Se quitan los conversation_hides de ese chat para cliente y profesional.
--   * Repetir el RPC no vuelve a insertar el evento en el mismo chat.
-- DROP primero: Postgres no deja cambiar el tipo de retorno con CREATE OR REPLACE.

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
  v_cliente uuid;
  v_trabajador uuid;
  v_active uuid;
  v_trade text;
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
    SELECT c.deleted_at, c.primary_trade
      INTO v_own_deleted, v_trade
    FROM public.conversations c
    WHERE c.id = v_own_id
      AND c.cliente_id = v_cliente
      AND c.trabajador_id = v_trabajador;

    IF NOT FOUND THEN
      v_own_id := NULL;
      v_own_deleted := NULL;
      v_trade := NULL;
    END IF;
  END IF;

  -- Chat propio vivo: no se toca ningún otro hilo del par.
  IF v_own_id IS NOT NULL AND v_own_deleted IS NULL THEN
    v_conv_id := v_own_id;
  ELSE
    -- ux_conversations_active_pair: como mucho un hilo activo por par.
    SELECT c.id
      INTO v_active
    FROM public.conversations c
    WHERE c.cliente_id = v_cliente
      AND c.trabajador_id = v_trabajador
      AND c.deleted_at IS NULL
    ORDER BY c.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_active IS NOT NULL THEN
      -- Cerrar solo si hay otro trabajo y todos están finalizados, sin reclamo
      -- abierto ni pendiente. Un trabajo en curso, cancelado, en disputa o con
      -- reclamo abierto bloquea el cierre: el evento va a ese chat.
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

    IF v_active IS NOT NULL AND v_can_close THEN
      PERFORM public.hide_conversation_for_participants(v_active);
      v_active := NULL;
    END IF;

    IF v_active IS NOT NULL THEN
      v_conv_id := v_active;
      v_on_other_chat := true;
    ELSE
      INSERT INTO public.conversations (cliente_id, trabajador_id, primary_trade, updated_at)
      VALUES (v_cliente, v_trabajador, v_trade, now())
      RETURNING id INTO v_conv_id;
    END IF;
  END IF;

  UPDATE public.contrataciones
  SET conversation_id = v_conv_id
  WHERE id = p_contratacion_id
    AND conversation_id IS DISTINCT FROM v_conv_id;

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

  -- Un ciclo nuevo siempre avisa. Si el reclamo ya estaba abierto, solo se
  -- inserta cuando este chat todavía no tiene el evento (p. ej. conversation_id
  -- era NULL y el intento anterior no llegó a escribir el mensaje).
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
  'El cliente abre o vuelve a un reclamo de garantía y deja un chat usable. No oculta el chat de otro trabajo en curso o con reclamo abierto, ni mueve el ancla ni el estado del trabajo.';
