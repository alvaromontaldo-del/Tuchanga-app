-- Card «Agenda: liberar bloqueos de horario cuando un trabajo se cancela o
-- finaliza» (Trello sSNGdgdP).
--
-- Aplicado en producción (kyxehrxcdealbujvvnxp) el 2026-10-02, con diff contra
-- producción (pg_get_functiondef) y prueba en seco con ROLLBACK.
--
-- Qué cambia:
--   1) Trigger nuevo en contrataciones: cuando el trabajo pasa a 'cancelado', o
--      queda 'finalizado' sin reclamo de garantía abierto, sus bloques de agenda
--      (reserved / tentative) pasan a 'free'.
--   2) Limpieza única de los bloques viejos que quedaron reservados por trabajos
--      ya cancelados o finalizados sin reclamo abierto (ej.: profesional
--      570cf8cb, 25/10 17:09–18:09).
--   3) aceptar_disponibilidad_opcion usa el mismo criterio de «ocupado» que
--      proponer_disponibilidad_opciones (#43): _agenda_conflicting_busy_slot.
--      Solo cambia el chequeo de solape; el resto del cuerpo queda igual.
--
-- Trabajo vigente (mismo predicado que _agenda_conflicting_busy_slot):
--   estado_trabajo IN ('aceptado', 'en_curso')
--   o 'finalizado' con is_claim_open y claim_status IN ('open', 'pending_approval').
--
-- Por pedido de Alvaro (comentario del 2026-10-02) NO se toca la revisita por
-- garantía (reagendar): proponer_reagendar_visita, aceptar_reagendar_visita,
-- rechazar_reagendar_visita y _agenda_slot_overlaps quedan como están.
-- Tampoco se recrean _agenda_conflicting_busy_slot, proponer_disponibilidad_opciones,
-- _agenda_free_blocks, _agenda_ensure_reserved ni funciones de búsqueda.
--
-- Si después un trabajo finalizado abre un reclamo y el cliente acepta un
-- horario de revisita, aceptar_disponibilidad_opcion vuelve a crear el bloque
-- reservado con _agenda_ensure_reserved (no depende del bloque viejo).

-- 1) Trigger: liberar bloques al cancelar o finalizar sin reclamo abierto.
CREATE OR REPLACE FUNCTION public.trg_contratacion_free_agenda_blocks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.estado_trabajo = 'cancelado'
     OR (
       NEW.estado_trabajo = 'finalizado'
       AND NOT (
         coalesce(NEW.is_claim_open, false)
         AND NEW.claim_status IN ('open', 'pending_approval')
       )
     )
  THEN
    PERFORM public._agenda_free_blocks(NEW.id, ARRAY['reserved', 'tentative']);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_contratacion_free_agenda_blocks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_contratacion_free_agenda_blocks() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_contratacion_free_agenda_blocks() TO service_role;

DROP TRIGGER IF EXISTS trg_contratacion_free_agenda_blocks ON public.contrataciones;
CREATE TRIGGER trg_contratacion_free_agenda_blocks
AFTER UPDATE OF estado_trabajo, is_claim_open, claim_status ON public.contrataciones
FOR EACH ROW
WHEN (
  OLD.estado_trabajo IS DISTINCT FROM NEW.estado_trabajo
  OR OLD.is_claim_open IS DISTINCT FROM NEW.is_claim_open
  OR OLD.claim_status IS DISTINCT FROM NEW.claim_status
)
EXECUTE FUNCTION public.trg_contratacion_free_agenda_blocks();

-- 2) Limpieza de bloques viejos.
UPDATE public.professional_agenda_blocks b
SET status = 'free', updated_at = now()
FROM public.contrataciones c
WHERE c.id = b.contratacion_id
  AND b.status IN ('reserved', 'tentative')
  AND (
    c.estado_trabajo = 'cancelado'
    OR (
      c.estado_trabajo = 'finalizado'
      AND NOT (
        coalesce(c.is_claim_open, false)
        AND c.claim_status IN ('open', 'pending_approval')
      )
    )
  );

-- 3) aceptar_disponibilidad_opcion: mismo criterio de ocupado que #43.
CREATE OR REPLACE FUNCTION public.aceptar_disponibilidad_opcion(p_opcion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_opc public.disponibilidad_opciones%rowtype;
  v_row public.contrataciones%rowtype;
  v_body text;
  v_claim boolean := false;
BEGIN
  IF p_opcion_id IS NULL THEN
    RAISE EXCEPTION 'Opción inválida: id requerido';
  END IF;

  SELECT * INTO v_opc
  FROM public.disponibilidad_opciones
  WHERE id = p_opcion_id;

  IF NOT FOUND OR v_opc.estado <> 'propuesta' THEN
    RAISE EXCEPTION 'Opción no disponible';
  END IF;

  v_row := public._assert_contratacion_participante(v_opc.contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede aceptar la disponibilidad';
  END IF;

  v_claim := (
    v_row.estado_trabajo = 'finalizado'
    AND v_row.is_claim_open
    AND v_row.claim_status IN ('open', 'pending_approval')
  );

  IF v_row.estado_trabajo <> 'precio_aceptado' AND NOT v_claim THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  PERFORM public._agenda_lock_worker(v_row.worker_id);

  -- Mismo criterio que proponer_disponibilidad_opciones (#43): solo cuentan
  -- trabajos vigentes de otros clientes, sus propuestas pendientes y sus
  -- bloques; los bloques de trabajos cancelados o finalizados no.
  IF EXISTS (
    SELECT 1
    FROM public._agenda_conflicting_busy_slot(
      v_row.worker_id, v_opc.contratacion_id,
      v_opc.fecha_trabajo, v_opc.hora_inicio, v_opc.hora_fin
    )
  ) THEN
    RAISE EXCEPTION 'Ese horario ya no está disponible en la agenda del profesional';
  END IF;

  UPDATE public.disponibilidad_opciones
  SET estado = 'descartada'
  WHERE contratacion_id = v_opc.contratacion_id
    AND estado = 'propuesta'
    AND id <> p_opcion_id;

  UPDATE public.disponibilidad_opciones
  SET estado = 'aceptada'
  WHERE id = p_opcion_id;

  IF v_claim THEN
    UPDATE public.contrataciones
    SET
      fecha_trabajo = v_opc.fecha_trabajo,
      hora_inicio = v_opc.hora_inicio,
      hora_fin = v_opc.hora_fin,
      updated_at = now()
    WHERE id = v_opc.contratacion_id;
  ELSE
    UPDATE public.contrataciones
    SET
      fecha_trabajo = v_opc.fecha_trabajo,
      hora_inicio = v_opc.hora_inicio,
      hora_fin = v_opc.hora_fin,
      estado_trabajo = 'aceptado'
    WHERE id = v_opc.contratacion_id;
  END IF;

  PERFORM public._agenda_ensure_reserved(v_opc.contratacion_id);

  v_body := CASE
    WHEN v_claim THEN '✅ (Garantía) Confirmé el horario de revisión: '
    ELSE '✅ Confirmé el horario: '
  END
    || to_char(v_opc.fecha_trabajo, 'DD/MM/YYYY') || ' '
    || to_char(v_opc.hora_inicio, 'HH24:MI') || '–' || to_char(v_opc.hora_fin, 'HH24:MI');

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    v_body,
    jsonb_build_object(
      'event', 'horario_confirmado',
      'contratacion_id', v_opc.contratacion_id,
      'audience', 'todos',
      'opcion_id', p_opcion_id
    )
  );
END;
$function$;

-- Permisos de aceptar_disponibilidad_opcion: iguales a producción
-- (authenticated y service_role; sin anon ni PUBLIC).
REVOKE ALL ON FUNCTION public.aceptar_disponibilidad_opcion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aceptar_disponibilidad_opcion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.aceptar_disponibilidad_opcion(uuid) TO authenticated, service_role;
