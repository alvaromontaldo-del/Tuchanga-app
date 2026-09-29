-- Después de #37 cada reclamo vive en su hilo (conversations.contratacion_id).
-- El chat general (contratacion_id IS NULL) ya no tiene esas contrataciones,
-- así que chat_cerrado_por_reclamo_conformidad no puede ocultarlo.
-- Ocultarlo solo en la app dejaría el hilo reutilizable: find_or_create_conversation
-- lo vuelve a abrir y enforce_message_rules lo bloquea. Hay que marcarlo con
-- hide_conversation_for_participants para que el próximo contacto cree un hilo nuevo.
--
-- No se recrean hide_conversation_for_participants, enforce_message_rules,
-- find_or_create_conversation ni iniciar_reclamo_garantia.

CREATE OR REPLACE FUNCTION public.hide_general_chats_if_all_claims_closed(
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
      AND conv.contratacion_id IS NULL
      AND conv.deleted_at IS NULL
  LOOP
    -- (a) el par tiene al menos un reclamo iniciado
    -- (b) cada contratación del par con reclamo iniciado está cerrada
    -- (c) este hilo general no tiene un trabajo vivo
    IF EXISTS (
         SELECT 1
         FROM public.contrataciones ct
         WHERE ct.client_id = p_client
           AND ct.worker_id = p_worker
           AND ct.claim_opened_at IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.contrataciones ct
         WHERE ct.client_id = p_client
           AND ct.worker_id = p_worker
           AND ct.claim_opened_at IS NOT NULL
           AND NOT (
             ct.is_claim_open = false
             AND ct.claim_status = 'closed'
           )
       )
       AND NOT public.conversation_tiene_trabajo_vivo(c.id)
    THEN
      PERFORM public.hide_conversation_for_participants(c.id);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.hide_general_chats_if_all_claims_closed(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hide_general_chats_if_all_claims_closed(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.hide_general_chats_if_all_claims_closed(uuid, uuid) FROM authenticated;

COMMENT ON FUNCTION public.hide_general_chats_if_all_claims_closed(uuid, uuid) IS
  'Oculta el chat general del par cuando todos los reclamos iniciados están cerrados y el hilo no tiene trabajo vivo. El próximo contacto crea un hilo general nuevo.';

-- Cuerpo de producción de confirmar_arreglo_garantia. Único cambio: después
-- del UPDATE, ocultar el chat general del par si ya no queda un reclamo abierto.
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

  PERFORM public.hide_general_chats_if_all_claims_closed(v_row.client_id, v_row.worker_id);

  PERFORM public._chat_notify_contratacion(
    v_row.conversation_id,
    '✅ El cliente confirmó el arreglo. Reclamo cerrado. La garantía de 30 días continúa sin reiniciarse.'
  );

  RETURN jsonb_build_object('ok', true, 'claimStatus', 'closed');
END;
$$;

-- Cuerpo de producción de auto_approve_stale_warranty_claims. Único cambio:
-- el SELECT trae el par y, después de cada UPDATE, se oculta el chat general
-- de ese par si ya no queda un reclamo abierto.
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

    PERFORM public.hide_general_chats_if_all_claims_closed(r.client_id, r.worker_id);

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
--     PERFORM public.hide_general_chats_if_all_claims_closed(pair.client_id, pair.worker_id);
--   END LOOP;
-- END
-- $$;
