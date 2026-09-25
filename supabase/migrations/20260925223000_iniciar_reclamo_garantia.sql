-- Reclamo de garantía desde Trabajos contratados.
-- El cliente lo inicia mientras quedan días. No cambia estado_trabajo
-- ni warranty_anchor_at: el plazo sigue corriendo.
-- Reabre el chat del trabajo (o el hilo activo del mismo par) para coordinar.

CREATE OR REPLACE FUNCTION public.iniciar_reclamo_garantia(p_contratacion_id uuid)
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
  v_cliente uuid;
  v_trabajador uuid;
  v_deleted timestamptz;
  v_active uuid;
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

  v_conv_id := v_row.conversation_id;

  SELECT c.cliente_id, c.trabajador_id, c.deleted_at
    INTO v_cliente, v_trabajador, v_deleted
  FROM public.conversations c
  WHERE c.id = v_conv_id;

  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'No hay chat para este trabajo';
  END IF;

  IF v_deleted IS NOT NULL THEN
    SELECT c.id INTO v_active
    FROM public.conversations c
    WHERE c.cliente_id = v_cliente
      AND c.trabajador_id = v_trabajador
      AND c.deleted_at IS NULL
      AND c.id <> v_conv_id
    LIMIT 1;

    IF v_active IS NOT NULL THEN
      v_conv_id := v_active;
    ELSE
      UPDATE public.conversations
      SET deleted_at = NULL, updated_at = now()
      WHERE id = v_conv_id;
    END IF;
  END IF;

  DELETE FROM public.conversation_hides
  WHERE conversation_id = v_conv_id
    AND user_id IN (v_cliente, v_trabajador);

  IF NOT v_already THEN
    PERFORM public._chat_insert_system_event(
      v_conv_id,
      auth.uid(),
      'El cliente inició un reclamo de garantía. Coordinen la revisión por este chat. La garantía sigue su curso.',
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
GRANT EXECUTE ON FUNCTION public.iniciar_reclamo_garantia(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.iniciar_reclamo_garantia(uuid) IS
  'El cliente abre un reclamo de garantía y reabre el chat. No mueve el ancla ni el estado del trabajo.';
