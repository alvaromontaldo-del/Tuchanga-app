-- =============================================================================
-- Cierre de chat + purga de imágenes:
--   Se activa cuando AMBAS condiciones se cumplen:
--     1) Cliente dejó reseña (worker_reviews)
--     2) Trabajador confirmó recepción del pago (estado_pago = totalmente_pagado
--        + offline_pago_confirmado_at / paid_at)
--   Retención configurable (hoy = 0 días = inmediato; más adelante 15).
--   El chat se OCULTA para cliente y trabajador (conversation_hides), sin DELETE.
--   Las imágenes se listan para borrar (Storage + filas messages) vía Edge Function.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_cleanup_retention_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  -- Ahora: inmediato. Más adelante cambiar a 15.
  SELECT 0;
$$;

COMMENT ON FUNCTION public.chat_cleanup_retention_days() IS
  'Días de espera tras reseña+pago confirmado antes de purgar imágenes/ocultar chat. Hoy 0.';

ALTER TABLE public.contrataciones
  ADD COLUMN IF NOT EXISTS chat_archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.hide_conversation_for_participants(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  ts timestamptz := now();
BEGIN
  SELECT c.cliente_id, c.trabajador_id
    INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF v_cliente IS NULL OR v_trabajador IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.conversation_hides (conversation_id, user_id, hidden_at)
  VALUES
    (p_conversation_id, v_cliente, ts),
    (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET hidden_at = EXCLUDED.hidden_at;

  INSERT INTO public.conversation_reads (conversation_id, user_id, read_at)
  VALUES
    (p_conversation_id, v_cliente, ts),
    (p_conversation_id, v_trabajador, ts)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET read_at = EXCLUDED.read_at;
END;
$$;

REVOKE ALL ON FUNCTION public.hide_conversation_for_participants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hide_conversation_for_participants(uuid) TO service_role;

/**
 * ¿Esta contratación ya tiene reseña + pago confirmado por el trabajador?
 * Si además cumplió la retención, oculta el chat a ambos y marca chat_archived_at.
 */
CREATE OR REPLACE FUNCTION public.try_archive_chat_after_job_complete(
  p_contratacion_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_review_at timestamptz;
  v_ready_at timestamptz;
  v_days integer := public.chat_cleanup_retention_days();
BEGIN
  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id;

  IF NOT FOUND OR v_row.conversation_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_row.estado_pago IS DISTINCT FROM 'totalmente_pagado' THEN
    RETURN false;
  END IF;

  IF v_row.offline_pago_confirmado_at IS NULL AND v_row.paid_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT wr.created_at INTO v_review_at
  FROM public.worker_reviews wr
  WHERE wr.job_id = p_contratacion_id
     OR wr.conversation_id = v_row.conversation_id
  ORDER BY wr.created_at ASC
  LIMIT 1;

  IF v_review_at IS NULL THEN
    RETURN false;
  END IF;

  v_ready_at := GREATEST(
    v_review_at,
    coalesce(v_row.offline_pago_confirmado_at, v_row.paid_at, v_review_at)
  );

  IF v_ready_at > (now() - make_interval(days => GREATEST(0, v_days))) THEN
    RETURN false;
  END IF;

  -- No archivar si hay otro trabajo activo en el mismo hilo
  IF EXISTS (
    SELECT 1
    FROM public.contrataciones a
    WHERE a.conversation_id = v_row.conversation_id
      AND a.id <> p_contratacion_id
      AND a.estado_trabajo NOT IN ('finalizado', 'cancelado', 'disputa')
  ) THEN
    RETURN false;
  END IF;

  PERFORM public.hide_conversation_for_participants(v_row.conversation_id);

  UPDATE public.contrataciones
  SET chat_archived_at = coalesce(chat_archived_at, now())
  WHERE id = p_contratacion_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.try_archive_chat_after_job_complete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_archive_chat_after_job_complete(uuid) TO authenticated, service_role;

-- Reemplaza elegibilidad: reseña + pago confirmado (+ retención)
CREATE OR REPLACE FUNCTION public.list_expired_chat_images(
  p_retention_days integer DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  image_url text,
  storage_path text,
  closed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := coalesce(p_retention_days, public.chat_cleanup_retention_days());
BEGIN
  v_days := GREATEST(0, v_days);

  RETURN QUERY
  WITH ready AS (
    SELECT
      c.id AS contratacion_id,
      c.conversation_id,
      GREATEST(
        wr.created_at,
        coalesce(c.offline_pago_confirmado_at, c.paid_at, wr.created_at)
      ) AS closed_at
    FROM public.contrataciones c
    INNER JOIN public.worker_reviews wr
      ON wr.job_id = c.id
      OR wr.conversation_id = c.conversation_id
    WHERE c.estado_pago = 'totalmente_pagado'
      AND (c.offline_pago_confirmado_at IS NOT NULL OR c.paid_at IS NOT NULL)
      AND c.conversation_id IS NOT NULL
  ),
  eligible AS (
    SELECT
      r.conversation_id,
      MAX(r.closed_at) AS closed_at
    FROM ready r
    WHERE r.closed_at <= (now() - make_interval(days => v_days))
      AND NOT EXISTS (
        SELECT 1
        FROM public.contrataciones a
        WHERE a.conversation_id = r.conversation_id
          AND a.estado_trabajo NOT IN ('finalizado', 'cancelado', 'disputa')
      )
    GROUP BY r.conversation_id
  )
  SELECT
    m.id AS message_id,
    m.conversation_id,
    nullif(trim(coalesce(m.metadata->>'image_url', '')), '') AS image_url,
    public.chat_image_storage_path(m.metadata->>'image_url') AS storage_path,
    e.closed_at
  FROM eligible e
  JOIN public.messages m
    ON m.conversation_id = e.conversation_id
   AND m.type = 'image';
END;
$$;

REVOKE ALL ON FUNCTION public.list_expired_chat_images(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_chat_images(integer) TO service_role;

/**
 * Archiva chats elegibles (hide ambos) y lista imágenes a purgar.
 */
CREATE OR REPLACE FUNCTION public.archive_eligible_chats_and_list_images(
  p_retention_days integer DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  image_url text,
  storage_path text,
  closed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := coalesce(p_retention_days, public.chat_cleanup_retention_days());
  r record;
BEGIN
  v_days := GREATEST(0, v_days);

  FOR r IN
    SELECT DISTINCT c.id AS contratacion_id
    FROM public.contrataciones c
    INNER JOIN public.worker_reviews wr
      ON wr.job_id = c.id
      OR wr.conversation_id = c.conversation_id
    WHERE c.estado_pago = 'totalmente_pagado'
      AND (c.offline_pago_confirmado_at IS NOT NULL OR c.paid_at IS NOT NULL)
      AND c.conversation_id IS NOT NULL
      AND GREATEST(
            wr.created_at,
            coalesce(c.offline_pago_confirmado_at, c.paid_at, wr.created_at)
          ) <= (now() - make_interval(days => v_days))
  LOOP
    PERFORM public.try_archive_chat_after_job_complete(r.contratacion_id);
  END LOOP;

  RETURN QUERY
  SELECT * FROM public.list_expired_chat_images(v_days);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_eligible_chats_and_list_images(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_eligible_chats_and_list_images(integer) TO service_role;

-- Al confirmar pago: intentar archivar si ya hay reseña
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

-- Tras insertar reseña: intentar archivar si el pago ya fue confirmado
CREATE OR REPLACE FUNCTION public.on_worker_review_try_archive_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    PERFORM public.try_archive_chat_after_job_complete(NEW.job_id);
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_worker_reviews_try_archive_chat ON public.worker_reviews;
CREATE TRIGGER trg_worker_reviews_try_archive_chat
  AFTER INSERT ON public.worker_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.on_worker_review_try_archive_chat();
