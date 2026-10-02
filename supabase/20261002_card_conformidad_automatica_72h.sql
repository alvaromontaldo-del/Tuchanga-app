-- Card #115 «Conformidad automática si el cliente no responde (72 h)»
-- (Trello F347GhDT).
--
-- Aplicado en producción (kyxehrxcdealbujvvnxp) el 2026-10-02, con prueba en
-- seco con ROLLBACK (trabajo simulado en pendiente_conformidad).
--
-- Qué hace:
--   * Si un trabajo queda en 'pendiente_conformidad' 72 h sin respuesta del
--     cliente, pasa solo a 'finalizado' con los mismos efectos que «Estoy
--     conforme» (cliente_responder_conformidad con p_conforme = true):
--     finalizado_at, completed_by_worker_at, conformidad_respondida_at,
--     conformidad_aceptada = true, hide_pair_chats_if_done (#84). La garantía
--     arranca por trg_contratacion_set_warranty_anchor. El pago no se toca.
--   * Marca contrataciones.conformidad_automatica = true para que admin y
--     soporte sepan que fue automática.
--   * Recordatorio push al cliente a las 24 h y a las 48 h, y aviso push a los
--     dos (cliente y profesional) cuando se confirma solo. Usa el mecanismo de
--     siempre: mensaje 'system' con metadata.audience -> trigger «YaChanga» ->
--     edge function push_on_message.
--   * Idempotente: los recordatorios quedan anotados en
--     conformidad_recordatorio_24h_at / _48h_at y la confirmación solo corre
--     si el trabajo sigue en pendiente_conformidad sin respuesta.
--   * No toca trabajos con reclamo de garantía abierto.
--   * Corre con pg_cron cada 15 minutos (job 'conformidad_automatica_72h').
--
-- Funciones NUEVAS (no existían): public.auto_confirmar_conformidad_vencida().
-- No se recrea ninguna función existente (ni cliente_responder_conformidad,
-- ni trabajador_finalizar_trabajo, ni push, chat, pagos o búsqueda).
-- La función nueva no la puede ejecutar anon, authenticated ni PUBLIC.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

ALTER TABLE public.contrataciones
  ADD COLUMN IF NOT EXISTS conformidad_automatica boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conformidad_recordatorio_24h_at timestamptz,
  ADD COLUMN IF NOT EXISTS conformidad_recordatorio_48h_at timestamptz;

COMMENT ON COLUMN public.contrataciones.conformidad_automatica IS
  '#115: true si el trabajo pasó a finalizado solo, porque el cliente no respondió la conformidad en 72 h.';

-- Los participantes pueden leer el flag (los recordatorios no).
GRANT SELECT (conformidad_automatica) ON public.contrataciones TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_confirmar_conformidad_vencida()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plazo constant interval := interval '72 hours';
  r record;
  v_deadline timestamptz;
  v_horas integer;
  v_n integer;
  v_garantia text;
  v_rec24 integer := 0;
  v_rec48 integer := 0;
  v_auto integer := 0;
BEGIN
  -- Una sola corrida a la vez.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('auto_confirmar_conformidad_vencida', 0)) THEN
    RETURN jsonb_build_object('skipped', 'locked');
  END IF;

  FOR r IN
    SELECT c.id, c.conversation_id, c.client_id, c.worker_id,
           c.conformidad_solicitada_at, c.warranty_days,
           c.conformidad_recordatorio_24h_at, c.conformidad_recordatorio_48h_at
    FROM public.contrataciones c
    WHERE c.estado_trabajo = 'pendiente_conformidad'
      AND c.conformidad_solicitada_at IS NOT NULL
      AND c.conformidad_respondida_at IS NULL
      AND c.conformidad_solicitada_at <= now() - interval '24 hours'
      AND NOT coalesce(c.is_claim_open, false)
      AND coalesce(c.claim_status, 'none') NOT IN ('open', 'pending_approval')
    ORDER BY c.conformidad_solicitada_at
    FOR UPDATE SKIP LOCKED
  LOOP
    v_deadline := r.conformidad_solicitada_at + v_plazo;

    IF now() >= v_deadline THEN
      -- Mismo UPDATE que «Estoy conforme», más el flag.
      UPDATE public.contrataciones
      SET
        estado_trabajo = 'finalizado',
        finalizado_at = now(),
        completed_by_worker_at = coalesce(completed_by_worker_at, now()),
        conformidad_respondida_at = now(),
        conformidad_aceptada = true,
        conformidad_automatica = true
      WHERE id = r.id
        AND estado_trabajo = 'pendiente_conformidad'
        AND conformidad_respondida_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      CONTINUE WHEN v_n = 0;

      PERFORM public.hide_pair_chats_if_done(r.client_id, r.worker_id);

      v_garantia := CASE
        WHEN coalesce(r.warranty_days, 0) > 0
          THEN ' Desde ahora corren los ' || r.warranty_days || ' días de garantía.'
        ELSE ''
      END;

      IF r.conversation_id IS NOT NULL THEN
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES
          (
            r.conversation_id,
            r.client_id,
            '✅ Pasaron 72 h sin tu respuesta, así que dimos el trabajo por conforme.'
              || v_garantia || ' Podés dejar tu reseña.',
            'system',
            jsonb_build_object(
              'event', 'conformidad_aceptada',
              'contratacion_id', r.id,
              'audience', 'cliente',
              'automatica', true
            )
          ),
          (
            r.conversation_id,
            r.worker_id,
            '✅ El cliente no respondió en 72 h, así que dimos el trabajo por conforme.'
              || v_garantia,
            'system',
            jsonb_build_object(
              'event', 'conformidad_automatica',
              'contratacion_id', r.id,
              'audience', 'trabajador',
              'automatica', true
            )
          );
      END IF;

      v_auto := v_auto + 1;

    ELSIF now() >= r.conformidad_solicitada_at + interval '48 hours' THEN
      IF r.conformidad_recordatorio_48h_at IS NOT NULL THEN
        CONTINUE;
      END IF;
      UPDATE public.contrataciones
      SET
        conformidad_recordatorio_48h_at = now(),
        conformidad_recordatorio_24h_at = coalesce(conformidad_recordatorio_24h_at, now())
      WHERE id = r.id
        AND conformidad_recordatorio_48h_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      CONTINUE WHEN v_n = 0;

      v_horas := greatest(1, ceil(extract(epoch FROM (v_deadline - now())) / 3600.0)::integer);
      IF r.conversation_id IS NOT NULL THEN
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES (
          r.conversation_id,
          r.worker_id,
          'Tu profesional marcó el trabajo como terminado. Si no respondés en '
            || v_horas || ' h lo damos por conforme.',
          'system',
          jsonb_build_object(
            'event', 'conformidad_recordatorio',
            'contratacion_id', r.id,
            'audience', 'cliente',
            'recordatorio', '48h'
          )
        );
      END IF;
      v_rec48 := v_rec48 + 1;

    ELSE
      IF r.conformidad_recordatorio_24h_at IS NOT NULL THEN
        CONTINUE;
      END IF;
      UPDATE public.contrataciones
      SET conformidad_recordatorio_24h_at = now()
      WHERE id = r.id
        AND conformidad_recordatorio_24h_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      CONTINUE WHEN v_n = 0;

      v_horas := greatest(1, ceil(extract(epoch FROM (v_deadline - now())) / 3600.0)::integer);
      IF r.conversation_id IS NOT NULL THEN
        INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
        VALUES (
          r.conversation_id,
          r.worker_id,
          'Tu profesional marcó el trabajo como terminado. Si no respondés en '
            || v_horas || ' h lo damos por conforme.',
          'system',
          jsonb_build_object(
            'event', 'conformidad_recordatorio',
            'contratacion_id', r.id,
            'audience', 'cliente',
            'recordatorio', '24h'
          )
        );
      END IF;
      v_rec24 := v_rec24 + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'recordatorios_24h', v_rec24,
    'recordatorios_48h', v_rec48,
    'confirmados', v_auto
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_confirmar_conformidad_vencida() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_confirmar_conformidad_vencida() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_confirmar_conformidad_vencida() TO service_role;

-- Cada 15 minutos. cron.schedule con nombre reemplaza el job si ya existe.
SELECT cron.schedule(
  'conformidad_automatica_72h',
  '*/15 * * * *',
  $cron$SELECT public.auto_confirmar_conformidad_vencida();$cron$
);
