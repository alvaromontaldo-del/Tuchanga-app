-- YaChanga — Fase 1: contrataciones + pagos (schema + RPCs MVP)
-- Renombra service_jobs → contrataciones, migra chat_quotes, elimina flujo legacy.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Enums nuevos
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contratacion_estado_trabajo') THEN
    CREATE TYPE public.contratacion_estado_trabajo AS ENUM (
      'pendiente',
      'precio_cotizado',
      'precio_aceptado',
      'aceptado',
      'en_curso',
      'pendiente_pago_diferencia',
      'finalizado',
      'cancelado',
      'disputa'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contratacion_estado_pago') THEN
    CREATE TYPE public.contratacion_estado_pago AS ENUM (
      'pendiente_seña',
      'seña_pagada',
      'totalmente_pagado'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaccion_tipo_pago') THEN
    CREATE TYPE public.transaccion_tipo_pago AS ENUM ('seña_inicial', 'diferencia_seña');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaccion_estado_mp') THEN
    CREATE TYPE public.transaccion_estado_mp AS ENUM (
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'refunded'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Helpers de comisión (22% markup sobre precio final)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calc_precios_contratacion(p_precio_trabajador numeric)
RETURNS TABLE (precio_final numeric, comision_app numeric)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_final numeric;
  v_comision numeric;
BEGIN
  IF p_precio_trabajador IS NULL OR p_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;

  v_final := round(p_precio_trabajador / (1 - 0.22), 2);
  v_comision := round(v_final - p_precio_trabajador, 2);

  RETURN QUERY SELECT v_final, v_comision;
END;
$$;

CREATE OR REPLACE FUNCTION public.generar_pin_verificacion()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

-- ---------------------------------------------------------------------------
-- 3) Columnas nuevas en service_jobs (antes del rename)
-- ---------------------------------------------------------------------------

ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS precio_trabajador numeric(12, 2),
  ADD COLUMN IF NOT EXISTS precio_final numeric(12, 2),
  ADD COLUMN IF NOT EXISTS comision_app numeric(12, 2),
  ADD COLUMN IF NOT EXISTS service_detail text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS estado_trabajo public.contratacion_estado_trabajo,
  ADD COLUMN IF NOT EXISTS estado_pago public.contratacion_estado_pago,
  ADD COLUMN IF NOT EXISTS fecha_trabajo date,
  ADD COLUMN IF NOT EXISTS hora_inicio time,
  ADD COLUMN IF NOT EXISTS hora_fin time,
  ADD COLUMN IF NOT EXISTS verification_pin text,
  ADD COLUMN IF NOT EXISTS pin_intentos_fallidos int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_bloqueado_hasta timestamptz,
  ADD COLUMN IF NOT EXISTS recotizacion_precio_trabajador numeric(12, 2),
  ADD COLUMN IF NOT EXISTS recotizacion_precio_final numeric(12, 2),
  ADD COLUMN IF NOT EXISTS recotizacion_comision_app numeric(12, 2),
  ADD COLUMN IF NOT EXISTS seña_pagada_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalizado_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_at timestamptz,
  ADD COLUMN IF NOT EXISTS conformidad_solicitada_at timestamptz,
  ADD COLUMN IF NOT EXISTS offline_pago_notificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputa_motivo text NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- 4) Data migration: service_jobs existentes + chat_quotes
-- ---------------------------------------------------------------------------

UPDATE public.service_jobs sj
SET
  precio_trabajador = q.net_amount,
  precio_final = q.final_amount,
  comision_app = round(q.final_amount - q.net_amount, 2),
  service_detail = coalesce(nullif(trim(q.service_detail), ''), sj.description, '')
FROM public.chat_quotes q
WHERE sj.quote_id = q.id;

UPDATE public.service_jobs sj
SET
  precio_trabajador = sj.amount,
  precio_final = sj.amount,
  comision_app = 0,
  service_detail = coalesce(nullif(trim(sj.service_detail), ''), sj.description, '')
WHERE sj.precio_trabajador IS NULL;

-- Cotizaciones sin job → nueva fila en service_jobs
ALTER TABLE public.service_jobs ALTER COLUMN quote_id DROP NOT NULL;

INSERT INTO public.service_jobs (
  conversation_id,
  quote_id,
  worker_id,
  client_id,
  amount,
  description,
  work_status,
  payment_status,
  precio_trabajador,
  precio_final,
  comision_app,
  service_detail,
  created_at,
  updated_at
)
SELECT
  q.conversation_id,
  q.id,
  q.worker_id,
  q.client_id,
  q.final_amount,
  coalesce(q.service_detail, ''),
  'COMPLETED_BY_WORKER'::public.job_work_status,
  CASE
    WHEN q.status = 'paid' THEN 'PAID'::public.job_payment_status
    ELSE 'PENDING'::public.job_payment_status
  END,
  q.net_amount,
  q.final_amount,
  round(q.final_amount - q.net_amount, 2),
  coalesce(q.service_detail, ''),
  q.created_at,
  q.updated_at
FROM public.chat_quotes q
WHERE q.job_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.service_jobs sj WHERE sj.quote_id = q.id
  );

-- Legacy: todo lo existente queda cerrado y pagado
UPDATE public.service_jobs
SET
  estado_trabajo = 'finalizado',
  estado_pago = 'totalmente_pagado',
  finalizado_at = coalesce(completed_by_worker_at, paid_at, updated_at, now()),
  paid_at = coalesce(paid_at, updated_at, now());

ALTER TABLE public.service_jobs
  ALTER COLUMN precio_trabajador SET NOT NULL,
  ALTER COLUMN precio_final SET NOT NULL,
  ALTER COLUMN comision_app SET NOT NULL,
  ALTER COLUMN estado_trabajo SET NOT NULL,
  ALTER COLUMN estado_pago SET NOT NULL,
  ALTER COLUMN estado_trabajo SET DEFAULT 'precio_cotizado',
  ALTER COLUMN estado_pago SET DEFAULT 'pendiente_seña';

-- Ampliar messages.type antes del INSERT histórico con 'quotation'
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'budget', 'quotation'));

-- Mensajes quotation históricos (idempotente por quote_id en metadata)
-- El trigger exige sender_id = auth.uid(); en SQL Editor (postgres) auth.uid() es NULL.
ALTER TABLE public.messages DISABLE TRIGGER trg_messages_enforce_rules;

INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata, created_at)
SELECT
  q.conversation_id,
  q.worker_id,
  coalesce(nullif(trim(q.service_detail), ''), 'Cotización'),
  'quotation',
  jsonb_build_object(
    'contratacion_id', coalesce(q.job_id, sj.id),
    'precio_final', q.final_amount,
    'precio_trabajador', q.net_amount,
    'legacy_quote_id', q.id,
    'migrated', true
  ),
  q.created_at
FROM public.chat_quotes q
LEFT JOIN public.service_jobs sj ON sj.quote_id = q.id
WHERE coalesce(q.job_id, sj.id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.conversation_id = q.conversation_id
      AND m.type = 'quotation'
      AND (m.metadata ->> 'legacy_quote_id')::uuid = q.id
  );

ALTER TABLE public.messages ENABLE TRIGGER trg_messages_enforce_rules;

-- ---------------------------------------------------------------------------
-- 5) Renombrar service_jobs → contrataciones; limpiar columnas legacy
-- ---------------------------------------------------------------------------

ALTER TABLE public.service_jobs RENAME TO contrataciones;

ALTER TABLE public.contrataciones
  DROP CONSTRAINT IF EXISTS service_jobs_unique_quote,
  DROP CONSTRAINT IF EXISTS service_jobs_participants_match;

ALTER TABLE public.contrataciones
  ADD CONSTRAINT contrataciones_participants_match CHECK (worker_id <> client_id);

-- Dependencias sobre columnas legacy (work_status / payment_status)
DROP POLICY IF EXISTS worker_reviews_insert_client ON public.worker_reviews;

DROP FUNCTION IF EXISTS public.accept_quote(uuid);
DROP FUNCTION IF EXISTS public.process_payment(uuid);
DROP FUNCTION IF EXISTS public.complete_job(uuid);

CREATE OR REPLACE FUNCTION public.recompute_profile_rating(p_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_avg numeric;
  v_done int;
BEGIN
  IF p_worker_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::int, coalesce(avg(rating)::numeric, 0)
    INTO v_count, v_avg
  FROM public.worker_reviews
  WHERE worker_id = p_worker_id;

  SELECT count(*)::int
    INTO v_done
  FROM public.contrataciones
  WHERE worker_id = p_worker_id
    AND estado_trabajo = 'finalizado';

  UPDATE public.profiles
  SET
    review_count = v_count,
    rating_average = round(v_avg::numeric, 3),
    total_jobs_done = v_done,
    updated_at = now()
  WHERE id = p_worker_id;
END;
$$;

ALTER TABLE public.contrataciones DROP COLUMN IF EXISTS quote_id;
ALTER TABLE public.contrataciones DROP COLUMN IF EXISTS amount;
ALTER TABLE public.contrataciones DROP COLUMN IF EXISTS description;
ALTER TABLE public.contrataciones DROP COLUMN IF EXISTS work_status;
ALTER TABLE public.contrataciones DROP COLUMN IF EXISTS payment_status;

DROP INDEX IF EXISTS idx_service_jobs_conversation;
DROP INDEX IF EXISTS idx_service_jobs_worker;

CREATE INDEX IF NOT EXISTS idx_contrataciones_conversation
  ON public.contrataciones (conversation_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_contrataciones_worker_agenda
  ON public.contrataciones (worker_id, fecha_trabajo, estado_trabajo);

CREATE UNIQUE INDEX IF NOT EXISTS ux_contrataciones_conversation_activa
  ON public.contrataciones (conversation_id)
  WHERE estado_trabajo NOT IN ('finalizado', 'cancelado');

-- FK worker_reviews.job_id → contrataciones (mismo OID tras rename; re-nombrar constraint)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'worker_reviews_job_id_fkey'
      AND conrelid = 'public.worker_reviews'::regclass
  ) THEN
    ALTER TABLE public.worker_reviews
      RENAME CONSTRAINT worker_reviews_job_id_fkey TO worker_reviews_contratacion_id_fkey;
  END IF;
END $$;

ALTER TABLE public.worker_reviews
  DROP CONSTRAINT IF EXISTS worker_reviews_quote_id_fkey;

ALTER TABLE public.worker_reviews
  DROP COLUMN IF EXISTS quote_id;

-- ---------------------------------------------------------------------------
-- 6) Eliminar chat_quotes y RPCs legacy
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_chat_quotes_enforce_detail ON public.chat_quotes;
DROP TRIGGER IF EXISTS trg_chat_quotes_touch_updated_at ON public.chat_quotes;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication p
    JOIN pg_publication_rel pr ON pr.prpubid = p.oid
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
      AND c.relname = 'chat_quotes'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_quotes;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DROP TABLE IF EXISTS public.chat_quotes CASCADE;

DROP TYPE IF EXISTS public.job_work_status;
DROP TYPE IF EXISTS public.job_payment_status;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_service_jobs_touch_updated_at ON public.contrataciones;
DROP TRIGGER IF EXISTS trg_contrataciones_touch_updated_at ON public.contrataciones;

CREATE OR REPLACE FUNCTION public.touch_contratacion_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contrataciones_touch_updated_at
  BEFORE UPDATE ON public.contrataciones
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_contratacion_updated_at();

-- Moderación en service_detail
DROP TRIGGER IF EXISTS trg_contrataciones_enforce_detail ON public.contrataciones;
CREATE TRIGGER trg_contrataciones_enforce_detail
  BEFORE INSERT OR UPDATE OF service_detail ON public.contrataciones
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_service_detail_rules();

-- ---------------------------------------------------------------------------
-- 7) profiles.saldo_credito
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saldo_credito numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (saldo_credito >= 0);

-- ---------------------------------------------------------------------------
-- 8) Tablas auxiliares
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.transacciones_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratacion_id uuid NOT NULL REFERENCES public.contrataciones (id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  tipo_pago public.transaccion_tipo_pago NOT NULL,
  monto numeric(12, 2) NOT NULL CHECK (monto >= 0),
  estado_mp public.transaccion_estado_mp NOT NULL DEFAULT 'pending',
  mp_preference_id text,
  mp_payment_id text,
  idempotency_key text NOT NULL,
  external_reference text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transacciones_pago_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_transacciones_pago_contratacion
  ON public.transacciones_pago (contratacion_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pin_intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratacion_id uuid NOT NULL REFERENCES public.contrataciones (id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  pin_ingresado text NOT NULL,
  exito boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pin_intentos_contratacion
  ON public.pin_intentos (contratacion_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 10) Helpers internos RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._assert_contratacion_participante(p_contratacion_id uuid)
RETURNS public.contrataciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contratación inexistente';
  END IF;

  IF v_row.client_id <> auth.uid() AND v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_contratacion_participante(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._assert_sin_contratacion_activa(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.contrataciones c
    WHERE c.conversation_id = p_conversation_id
      AND c.estado_trabajo NOT IN ('finalizado', 'cancelado')
  ) THEN
    RAISE EXCEPTION 'Ya existe una contratación activa en esta conversación';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_sin_contratacion_activa(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 11) RPCs MVP
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.crear_cotizacion(
  p_conversation_id uuid,
  p_precio_trabajador numeric,
  p_service_detail text DEFAULT ''
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

  PERFORM public._assert_sin_contratacion_activa(p_conversation_id);

  SELECT * INTO v_precios FROM public.calc_precios_contratacion(p_precio_trabajador);
  v_detail := coalesce(trim(p_service_detail), '');

  INSERT INTO public.contrataciones (
    conversation_id,
    worker_id,
    client_id,
    precio_trabajador,
    precio_final,
    comision_app,
    service_detail,
    estado_trabajo,
    estado_pago
  )
  VALUES (
    p_conversation_id,
    v_conv.trabajador_id,
    v_conv.cliente_id,
    p_precio_trabajador,
    v_precios.precio_final,
    v_precios.comision_app,
    v_detail,
    'precio_cotizado',
    'pendiente_seña'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.messages (conversation_id, sender_id, body, type, metadata)
  VALUES (
    p_conversation_id,
    auth.uid(),
    coalesce(nullif(v_detail, ''), 'Cotización'),
    'quotation',
    jsonb_build_object(
      'contratacion_id', v_id,
      'precio_final', v_precios.precio_final,
      'precio_trabajador', p_precio_trabajador
    )
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aceptar_precio_cotizado(p_contratacion_id uuid)
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
    RAISE EXCEPTION 'Solo el cliente puede aceptar el precio';
  END IF;

  IF v_row.estado_trabajo <> 'precio_cotizado' THEN
    RAISE EXCEPTION 'Estado inválido para aceptar precio';
  END IF;

  UPDATE public.contrataciones
  SET estado_trabajo = 'precio_aceptado'
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_precio_cotizado(p_contratacion_id uuid)
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
    RAISE EXCEPTION 'Solo el cliente puede rechazar el precio';
  END IF;

  IF v_row.estado_trabajo <> 'precio_cotizado' THEN
    RAISE EXCEPTION 'Estado inválido para rechazar precio';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_trabajo = 'cancelado',
    cancelado_at = now()
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.proponer_disponibilidad(
  p_contratacion_id uuid,
  p_fecha_trabajo date,
  p_hora_inicio time,
  p_hora_fin time
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

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede proponer disponibilidad';
  END IF;

  IF v_row.estado_trabajo <> 'precio_aceptado' THEN
    RAISE EXCEPTION 'Estado inválido para proponer disponibilidad';
  END IF;

  IF p_fecha_trabajo IS NULL OR p_hora_inicio IS NULL OR p_hora_fin IS NULL THEN
    RAISE EXCEPTION 'Fecha y horario requeridos';
  END IF;

  IF p_hora_fin <= p_hora_inicio THEN
    RAISE EXCEPTION 'Horario inválido';
  END IF;

  UPDATE public.contrataciones
  SET
    fecha_trabajo = p_fecha_trabajo,
    hora_inicio = p_hora_inicio,
    hora_fin = p_hora_fin
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aceptar_disponibilidad(p_contratacion_id uuid)
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
    RAISE EXCEPTION 'Solo el cliente puede aceptar la disponibilidad';
  END IF;

  IF v_row.estado_trabajo <> 'precio_aceptado' THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  IF v_row.fecha_trabajo IS NULL THEN
    RAISE EXCEPTION 'Aún no hay agenda propuesta';
  END IF;

  UPDATE public.contrataciones
  SET estado_trabajo = 'aceptado'
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_disponibilidad(p_contratacion_id uuid)
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
    RAISE EXCEPTION 'Solo el cliente puede rechazar la disponibilidad';
  END IF;

  IF v_row.estado_trabajo <> 'precio_aceptado' THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.contrataciones
  SET
    fecha_trabajo = NULL,
    hora_inicio = NULL,
    hora_fin = NULL
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aplicar_seña_con_credito(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_saldo numeric;
  v_monto numeric;
  v_pagado numeric;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede pagar la seña';
  END IF;

  IF v_row.estado_trabajo NOT IN ('aceptado', 'en_curso', 'pendiente_pago_diferencia') THEN
    RAISE EXCEPTION 'Estado inválido para pagar seña';
  END IF;

  IF v_row.estado_pago <> 'pendiente_seña' THEN
    RAISE EXCEPTION 'La seña ya fue registrada';
  END IF;

  -- Seña inicial o diferencia por recotización (solo el delta de comisión).
  v_monto := v_row.comision_app;
  IF v_row.estado_trabajo = 'en_curso' THEN
    SELECT coalesce(sum(monto), 0) INTO v_pagado
    FROM public.transacciones_pago
    WHERE contratacion_id = p_contratacion_id
      AND estado_mp = 'approved'
      AND tipo_pago IN ('seña_inicial', 'diferencia_seña');

    v_monto := greatest(round(v_row.comision_app - v_pagado, 2), 0);
  END IF;

  IF v_monto = 0 THEN
    UPDATE public.contrataciones
    SET
      estado_pago = 'seña_pagada',
      seña_pagada_at = coalesce(seña_pagada_at, now()),
      verification_pin = coalesce(verification_pin, public.generar_pin_verificacion())
    WHERE id = p_contratacion_id;
    RETURN;
  END IF;

  SELECT saldo_credito INTO v_saldo
  FROM public.profiles
  WHERE id = auth.uid()
  FOR UPDATE;

  IF coalesce(v_saldo, 0) < v_monto THEN
    RAISE EXCEPTION 'Crédito insuficiente';
  END IF;

  UPDATE public.profiles
  SET saldo_credito = saldo_credito - v_monto
  WHERE id = auth.uid();

  UPDATE public.contrataciones
  SET
    estado_pago = 'seña_pagada',
    seña_pagada_at = now(),
    verification_pin = public.generar_pin_verificacion(),
    pin_intentos_fallidos = 0,
    pin_bloqueado_hasta = NULL
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_seña_aprobada(
  p_contratacion_id uuid,
  p_tipo_pago public.transaccion_tipo_pago,
  p_monto numeric,
  p_mp_payment_id text,
  p_mp_preference_id text,
  p_idempotency_key text,
  p_external_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role';
  END IF;

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contratación inexistente';
  END IF;

  INSERT INTO public.transacciones_pago (
    contratacion_id,
    cliente_id,
    tipo_pago,
    monto,
    estado_mp,
    mp_payment_id,
    mp_preference_id,
    idempotency_key,
    external_reference
  )
  VALUES (
    p_contratacion_id,
    v_row.client_id,
    p_tipo_pago,
    p_monto,
    'approved',
    p_mp_payment_id,
    p_mp_preference_id,
    p_idempotency_key,
    p_external_reference
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF v_row.estado_pago = 'pendiente_seña' THEN
    UPDATE public.contrataciones
    SET
      estado_pago = 'seña_pagada',
      seña_pagada_at = now(),
      verification_pin = coalesce(verification_pin, public.generar_pin_verificacion()),
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL,
      recotizacion_precio_trabajador = NULL,
      recotizacion_precio_final = NULL,
      recotizacion_comision_app = NULL,
      estado_trabajo = CASE
        WHEN estado_trabajo = 'pendiente_pago_diferencia' THEN 'en_curso'
        ELSE estado_trabajo
      END
    WHERE id = p_contratacion_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_pin_cliente(p_contratacion_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede ver el PIN';
  END IF;

  IF v_row.estado_pago NOT IN ('seña_pagada', 'totalmente_pagado') THEN
    RAISE EXCEPTION 'PIN no disponible hasta pagar la seña';
  END IF;

  IF v_row.verification_pin IS NULL THEN
    RAISE EXCEPTION 'PIN no generado';
  END IF;

  RETURN v_row.verification_pin;
END;
$$;

CREATE OR REPLACE FUNCTION public.verificar_pin(
  p_contratacion_id uuid,
  p_pin_ingresado text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_ok boolean;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede verificar el PIN';
  END IF;

  IF v_row.estado_trabajo <> 'aceptado' OR v_row.estado_pago <> 'seña_pagada' THEN
    RAISE EXCEPTION 'Estado inválido para verificar PIN';
  END IF;

  IF v_row.pin_bloqueado_hasta IS NOT NULL AND v_row.pin_bloqueado_hasta > now() THEN
    RAISE EXCEPTION 'PIN bloqueado temporalmente';
  END IF;

  v_ok := v_row.verification_pin IS NOT NULL
    AND lpad(trim(coalesce(p_pin_ingresado, '')), 4, '0') = v_row.verification_pin;

  INSERT INTO public.pin_intentos (contratacion_id, actor_id, pin_ingresado, exito)
  VALUES (p_contratacion_id, auth.uid(), coalesce(p_pin_ingresado, ''), v_ok);

  IF v_ok THEN
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'en_curso',
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL
    WHERE id = p_contratacion_id;

    RETURN true;
  END IF;

  UPDATE public.contrataciones
  SET
    pin_intentos_fallidos = pin_intentos_fallidos + 1,
    pin_bloqueado_hasta = CASE
      WHEN pin_intentos_fallidos + 1 >= 5 THEN now() + interval '15 minutes'
      ELSE pin_bloqueado_hasta
    END
  WHERE id = p_contratacion_id;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_direccion_cliente(p_contratacion_id uuid)
RETURNS TABLE (
  direccion_texto text,
  lat double precision,
  lng double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede ver la dirección';
  END IF;

  IF v_row.estado_pago NOT IN ('seña_pagada', 'totalmente_pagado') THEN
    RAISE EXCEPTION 'Dirección no disponible hasta pagar la seña';
  END IF;

  IF v_row.fecha_trabajo IS NULL OR v_row.estado_trabajo NOT IN ('aceptado', 'en_curso', 'pendiente_pago_diferencia', 'finalizado', 'disputa') THEN
    RAISE EXCEPTION 'Agenda no confirmada';
  END IF;

  RETURN QUERY
  SELECT
    p.direccion_texto,
    ST_Y(p.location::geometry)::double precision,
    ST_X(p.location::geometry)::double precision
  FROM public.profiles p
  WHERE p.id = v_row.client_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recotizar_en_curso(
  p_contratacion_id uuid,
  p_nuevo_precio_trabajador numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_precios record;
  v_diff numeric;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede recotizar';
  END IF;

  IF v_row.estado_trabajo <> 'en_curso' THEN
    RAISE EXCEPTION 'Solo se puede recotizar con trabajo en curso';
  END IF;

  SELECT * INTO v_precios FROM public.calc_precios_contratacion(p_nuevo_precio_trabajador);
  v_diff := round(v_precios.comision_app - v_row.comision_app, 2);

  IF v_diff > 0 THEN
    UPDATE public.contrataciones
    SET
      recotizacion_precio_trabajador = p_nuevo_precio_trabajador,
      recotizacion_precio_final = v_precios.precio_final,
      recotizacion_comision_app = v_precios.comision_app,
      estado_trabajo = 'pendiente_pago_diferencia'
    WHERE id = p_contratacion_id;
  ELSE
    UPDATE public.contrataciones
    SET
      precio_trabajador = p_nuevo_precio_trabajador,
      precio_final = v_precios.precio_final,
      comision_app = v_precios.comision_app,
      recotizacion_precio_trabajador = NULL,
      recotizacion_precio_final = NULL,
      recotizacion_comision_app = NULL,
      estado_trabajo = 'en_curso'
    WHERE id = p_contratacion_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.aceptar_recotizacion(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_diff numeric;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede aceptar la recotización';
  END IF;

  IF v_row.estado_trabajo <> 'pendiente_pago_diferencia' THEN
    RAISE EXCEPTION 'No hay recotización pendiente';
  END IF;

  v_diff := round(v_row.recotizacion_comision_app - v_row.comision_app, 2);

  UPDATE public.contrataciones
  SET
    precio_trabajador = recotizacion_precio_trabajador,
    precio_final = recotizacion_precio_final,
    comision_app = recotizacion_comision_app,
    recotizacion_precio_trabajador = NULL,
    recotizacion_precio_final = NULL,
    recotizacion_comision_app = NULL,
    estado_trabajo = 'en_curso',
    estado_pago = CASE
      WHEN v_diff > 0 THEN 'pendiente_seña'::public.contratacion_estado_pago
      ELSE 'seña_pagada'::public.contratacion_estado_pago
    END
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_recotizacion(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_credito numeric;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede rechazar la recotización';
  END IF;

  IF v_row.estado_trabajo <> 'pendiente_pago_diferencia' THEN
    RAISE EXCEPTION 'No hay recotización pendiente';
  END IF;

  v_credito := round(v_row.comision_app * 0.9, 2);

  UPDATE public.profiles
  SET saldo_credito = saldo_credito + v_credito
  WHERE id = v_row.client_id;

  UPDATE public.contrataciones
  SET
    recotizacion_precio_trabajador = NULL,
    recotizacion_precio_final = NULL,
    recotizacion_comision_app = NULL,
    estado_trabajo = 'finalizado',
    finalizado_at = now()
  WHERE id = p_contratacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cliente_notificar_pago_offline(p_contratacion_id uuid)
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
    RAISE EXCEPTION 'Solo el cliente puede notificar pago offline';
  END IF;

  IF v_row.estado_trabajo NOT IN ('en_curso', 'finalizado') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;

  UPDATE public.contrataciones
  SET offline_pago_notificado_at = now()
  WHERE id = p_contratacion_id;
END;
$$;

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
    RAISE EXCEPTION 'El cliente aún no notificó el pago';
  END IF;

  UPDATE public.contrataciones
  SET estado_pago = 'totalmente_pagado'
  WHERE id = p_contratacion_id;
END;
$$;

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
  SET conformidad_solicitada_at = now()
  WHERE id = p_contratacion_id;
END;
$$;

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

  IF v_row.conformidad_solicitada_at IS NULL THEN
    RAISE EXCEPTION 'El trabajador aún no solicitó conformidad';
  END IF;

  IF p_conforme THEN
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'finalizado',
      finalizado_at = now(),
      completed_by_worker_at = coalesce(completed_by_worker_at, now())
    WHERE id = p_contratacion_id;
  ELSE
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'disputa',
      disputa_motivo = coalesce(trim(p_motivo_disputa), '')
    WHERE id = p_contratacion_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12) Rating: usar contrataciones finalizadas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recompute_profile_rating(p_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_avg numeric;
  v_done int;
BEGIN
  IF p_worker_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::int, coalesce(avg(rating)::numeric, 0)
    INTO v_count, v_avg
  FROM public.worker_reviews
  WHERE worker_id = p_worker_id;

  SELECT count(*)::int
    INTO v_done
  FROM public.contrataciones
  WHERE worker_id = p_worker_id
    AND estado_trabajo = 'finalizado';

  UPDATE public.profiles
  SET
    review_count = v_count,
    rating_average = round(v_avg::numeric, 3),
    total_jobs_done = v_done,
    updated_at = now()
  WHERE id = p_worker_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 13) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.contrataciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transacciones_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pin_intentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_jobs_select_participants ON public.contrataciones;
DROP POLICY IF EXISTS service_jobs_insert_none ON public.contrataciones;
DROP POLICY IF EXISTS service_jobs_update_none ON public.contrataciones;

DROP POLICY IF EXISTS contrataciones_select_participants ON public.contrataciones;
CREATE POLICY contrataciones_select_participants
ON public.contrataciones
FOR SELECT
TO authenticated
USING (client_id = auth.uid() OR worker_id = auth.uid());

DROP POLICY IF EXISTS contrataciones_insert_none ON public.contrataciones;
CREATE POLICY contrataciones_insert_none
ON public.contrataciones
FOR INSERT
TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS contrataciones_update_none ON public.contrataciones;
CREATE POLICY contrataciones_update_none
ON public.contrataciones
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS transacciones_pago_select_participant ON public.transacciones_pago;
CREATE POLICY transacciones_pago_select_participant
ON public.transacciones_pago
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.contrataciones c
    WHERE c.id = contratacion_id
      AND (c.client_id = auth.uid() OR c.worker_id = auth.uid())
  )
);

DROP POLICY IF EXISTS transacciones_pago_insert_none ON public.transacciones_pago;
CREATE POLICY transacciones_pago_insert_none
ON public.transacciones_pago
FOR INSERT
TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS transacciones_pago_update_none ON public.transacciones_pago;
CREATE POLICY transacciones_pago_update_none
ON public.transacciones_pago
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS pin_intentos_select_participant ON public.pin_intentos;
CREATE POLICY pin_intentos_select_participant
ON public.pin_intentos
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.contrataciones c
    WHERE c.id = contratacion_id
      AND (c.client_id = auth.uid() OR c.worker_id = auth.uid())
  )
);

DROP POLICY IF EXISTS pin_intentos_insert_none ON public.pin_intentos;
CREATE POLICY pin_intentos_insert_none
ON public.pin_intentos
FOR INSERT
TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS worker_reviews_insert_client ON public.worker_reviews;
CREATE POLICY worker_reviews_insert_client
ON public.worker_reviews
FOR INSERT
TO authenticated
WITH CHECK (
  client_id = auth.uid()
  AND job_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.contrataciones c
    WHERE c.id = job_id
      AND c.client_id = auth.uid()
      AND c.worker_id = worker_id
      AND c.estado_trabajo = 'finalizado'
  )
);

DROP POLICY IF EXISTS "profiles_select_service_job_peer" ON public.profiles;
CREATE POLICY "profiles_select_contratacion_peer"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.contrataciones c
    WHERE (
      c.client_id = auth.uid() AND c.worker_id = profiles.id
    ) OR (
      c.worker_id = auth.uid() AND c.client_id = profiles.id
    )
  )
);

-- ---------------------------------------------------------------------------
-- 14) GRANTs + ocultar verification_pin
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contrataciones TO authenticated, service_role;
GRANT SELECT ON TABLE public.transacciones_pago TO authenticated, service_role;
GRANT SELECT ON TABLE public.pin_intentos TO authenticated, service_role;

GRANT ALL ON TABLE public.transacciones_pago TO service_role;
GRANT ALL ON TABLE public.pin_intentos TO service_role;

REVOKE SELECT (verification_pin) ON TABLE public.contrataciones FROM authenticated;

REVOKE ALL ON FUNCTION public.crear_cotizacion(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_cotizacion(uuid, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.aceptar_precio_cotizado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aceptar_precio_cotizado(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rechazar_precio_cotizado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rechazar_precio_cotizado(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.proponer_disponibilidad(uuid, date, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proponer_disponibilidad(uuid, date, time, time) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.aceptar_disponibilidad(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aceptar_disponibilidad(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rechazar_disponibilidad(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rechazar_disponibilidad(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.aplicar_seña_con_credito(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_seña_con_credito(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_seña_aprobada(
  uuid, public.transaccion_tipo_pago, numeric, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_seña_aprobada(
  uuid, public.transaccion_tipo_pago, numeric, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.obtener_pin_cliente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_pin_cliente(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.verificar_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verificar_pin(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.obtener_direccion_cliente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_direccion_cliente(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.recotizar_en_curso(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recotizar_en_curso(uuid, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.aceptar_recotizacion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aceptar_recotizacion(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rechazar_recotizacion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rechazar_recotizacion(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cliente_notificar_pago_offline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_notificar_pago_offline(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.trabajador_confirmar_recepcion_offline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trabajador_confirmar_recepcion_offline(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.trabajador_finalizar_trabajo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trabajador_finalizar_trabajo(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cliente_responder_conformidad(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_responder_conformidad(uuid, boolean, text) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.calc_precios_contratacion(numeric) TO authenticated, service_role;

COMMIT;
