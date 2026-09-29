-- #84. El chat se borra con hide_conversation_for_participants (deleted_at +
-- hides de las dos partes) para que el próximo contacto cree un hilo general nuevo.
--
-- Dos casos:
--   1) Fin normal: el profesional marcó el trabajo finalizado
--      (completed_by_worker_at, aviso trabajo_finalizado), el cliente dio
--      conformidad (conformidad_aceptada) y el pago está completo
--      (estado_pago = totalmente_pagado).
--   2) Reclamo: el cliente lo abrió, el profesional volvió a marcar el arreglo
--      (claim_marked_done_at) y el cliente confirmó (o corrieron las 72 h).
--      Se oculta el hilo de ese reclamo. El general también, si el resto del
--      par ya está terminado.
--
-- No se oculta un hilo con trabajo vivo (conversation_tiene_trabajo_vivo) ni
-- el chat general si el par todavía tiene un reclamo abierto o pendiente, o
-- un trabajo que no está cerrado. Un trabajo solo cancelado no alcanza para
-- borrar el general, pero tampoco lo impide cuando otro ya terminó.
-- Los hilos de reclamo de otros trabajos se ocultan cada uno al cerrar el suyo.
--
-- No se recrean hide_conversation_for_participants, enforce_message_rules,
-- find_or_create_conversation, iniciar_reclamo_garantia ni try_archive_chat_after_job_complete.
-- El archivado con retención sigue en try_archive; este ocultado es inmediato.

DROP FUNCTION IF EXISTS public.hide_general_chats_if_all_claims_closed(uuid, uuid);

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
  v_pair_ready boolean;
BEGIN
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
    )
  INTO v_pair_ready;

  IF v_pair_ready THEN
    FOR c IN
      SELECT conv.id
      FROM public.conversations conv
      WHERE conv.cliente_id = p_client
        AND conv.trabajador_id = p_worker
        AND conv.contratacion_id IS NULL
        AND conv.deleted_at IS NULL
        AND NOT public.conversation_tiene_trabajo_vivo(conv.id)
    LOOP
      PERFORM public.hide_conversation_for_participants(c.id);
    END LOOP;
  END IF;

  FOR c IN
    SELECT conv.id
    FROM public.conversations conv
    JOIN public.contrataciones ct ON ct.id = conv.contratacion_id
    WHERE conv.cliente_id = p_client
      AND conv.trabajador_id = p_worker
      AND conv.deleted_at IS NULL
      AND conv.contratacion_id IS NOT NULL
      AND ct.claim_opened_at IS NOT NULL
      AND ct.claim_marked_done_at IS NOT NULL
      AND ct.claim_resolved_at IS NOT NULL
      AND ct.is_claim_open = false
      AND ct.claim_status = 'closed'
      AND NOT public.conversation_tiene_trabajo_vivo(conv.id)
  LOOP
    PERFORM public.hide_conversation_for_participants(c.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM authenticated;

COMMENT ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) IS
  'Oculta el chat general del par cuando todos los trabajos están cerrados (conformidad de las dos partes y pago, cancelado, o reclamo conforme) y oculta cada hilo de reclamo al cerrarse el suyo.';

-- Cuerpo de producción. Único cambio: después del UPDATE, evaluar el ocultado.
CREATE OR REPLACE FUNCTION public.trabajador_finalizar_trabajo(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede finalizar';
  END IF;

  IF v_row.estado_trabajo <> 'en_curso' THEN
    RAISE EXCEPTION 'Estado inválido para finalizar';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_trabajo = 'finalizado',
    finalizado_at = now(),
    completed_by_worker_at = now(),
    conformidad_aceptada = true,
    conformidad_solicitada_at = coalesce(conformidad_solicitada_at, now()),
    conformidad_respondida_at = coalesce(conformidad_respondida_at, now())
  WHERE id = p_contratacion_id;

  PERFORM public.hide_pair_chats_if_done(v_row.client_id, v_row.worker_id);

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional marcó el trabajo como finalizado. Podés dejar tu reseña.',
    jsonb_build_object(
      'event', 'trabajo_finalizado',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Marcaste el trabajo como finalizado.',
    jsonb_build_object(
      'event', 'trabajo_finalizado',
      'contratacion_id', p_contratacion_id,
      'audience', 'trabajador'
    )
  );
END;
$$;

-- Cuerpo de producción. Único cambio: después del UPDATE de conformidad aceptada.
CREATE OR REPLACE FUNCTION public.cliente_responder_conformidad(
  p_contratacion_id uuid,
  p_conforme boolean,
  p_motivo_disputa text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
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
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'disputa',
      disputa_motivo = coalesce(trim(p_motivo_disputa), ''),
      conformidad_respondida_at = now(),
      conformidad_aceptada = false
    WHERE id = p_contratacion_id;

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.client_id,
      'Indicaste que el trabajo no fue conforme. Podés cargar un reclamo en "Tuve un problema". '
        || 'Si preferís, también podés dejar una reseña.',
      jsonb_build_object(
        'event', 'conformidad_rechazada',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );
  END IF;
END;
$$;

-- Cuerpo de producción. Único cambio: después del UPDATE que deja el pago completo.
CREATE OR REPLACE FUNCTION public.trabajador_confirmar_recepcion_offline(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede confirmar recepción';
  END IF;

  IF v_row.offline_pago_notificado_at IS NULL THEN
    RAISE EXCEPTION 'El cliente aún no notificó el pago del saldo';
  END IF;

  IF v_row.estado_pago = 'totalmente_pagado' THEN
    RAISE EXCEPTION 'El pago ya fue confirmado';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_pago = 'totalmente_pagado',
    paid_at = coalesce(paid_at, now()),
    offline_pago_confirmado_at = now()
  WHERE id = p_contratacion_id;

  PERFORM public.hide_pair_chats_if_done(v_row.client_id, v_row.worker_id);

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional confirmó la recepción del saldo.',
    jsonb_build_object(
      'event', 'saldo_confirmado_cliente',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Confirmaste la recepción del saldo. Trabajo pagado.',
    jsonb_build_object(
      'event', 'saldo_confirmado_trabajador',
      'contratacion_id', p_contratacion_id,
      'audience', 'trabajador'
    )
  );

  -- Si ya hay reseña (+ retención 0), oculta el chat a ambos de inmediato
  PERFORM public.try_archive_chat_after_job_complete(p_contratacion_id);
END;
$$;

-- Cuerpo de producción. Único cambio: después del UPDATE, ocultar el par.
CREATE OR REPLACE FUNCTION public.confirmar_arreglo_garantia(p_contratacion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'solo_cliente_puede_confirmar_arreglo';
  END IF;

  IF NOT v_row.is_claim_open OR v_row.claim_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'no_hay_arreglo_pendiente_de_aprobacion';
  END IF;

  UPDATE public.contrataciones
  SET
    is_claim_open = false,
    claim_status = 'closed',
    claim_resolved_at = now(),
    updated_at = now()
  WHERE id = p_contratacion_id;

  PERFORM public.hide_pair_chats_if_done(v_row.client_id, v_row.worker_id);

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '✅ El cliente confirmó el arreglo. Reclamo cerrado. La garantía de 30 días continúa sin reiniciarse.'
  );

  RETURN jsonb_build_object('ok', true, 'claimStatus', 'closed');
END;
$$;

-- Cuerpo de producción. Único cambio: el SELECT trae el par y, después de
-- cada UPDATE, se evalúa el ocultado de ese par.
CREATE OR REPLACE FUNCTION public.auto_approve_stale_warranty_claims()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT c.id, c.conversation_id, c.client_id, c.worker_id
    FROM public.contrataciones c
    WHERE c.is_claim_open = true
      AND c.claim_status = 'pending_approval'
      AND c.claim_marked_done_at IS NOT NULL
      AND c.claim_marked_done_at <= now() - interval '72 hours'
  LOOP
    UPDATE public.contrataciones
    SET
      is_claim_open = false,
      claim_status = 'closed',
      claim_resolved_at = now(),
      updated_at = now()
    WHERE id = r.id;

    PERFORM public.hide_pair_chats_if_done(r.client_id, r.worker_id);

    BEGIN
      PERFORM public._chat_notify_contratacion(
        r.conversation_id,
        '✅ Reclamo de garantía cerrado automáticamente: el cliente no confirmó el arreglo en 72 horas. La garantía de 30 días sigue su curso normal.'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Backfill comentado. El revisor lo corre a mano, después del dry-run.
-- Descomentarlo no forma parte de aplicar esta migración.
--
-- DO $$
-- DECLARE
--   pair record;
-- BEGIN
--   FOR pair IN
--     SELECT DISTINCT ct.client_id, ct.worker_id
--     FROM public.contrataciones ct
--   LOOP
--     PERFORM public.hide_pair_chats_if_done(pair.client_id, pair.worker_id);
--   END LOOP;
-- END
-- $$;
