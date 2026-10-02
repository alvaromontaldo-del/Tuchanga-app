-- Card #4 «Recotizar», después de #39 (tramos del costo de servicio).
-- NO ejecutar desde la app. Aplicar a mano en Supabase y diffear contra producción.
--
-- Fuentes recreadas (pg_get_functiondef de producción, 2026-10-02, idénticas al repo):
--   recotizar_en_curso(uuid, numeric)
--     supabase/20261001_card_39_service_fee_tiers.sql
--   aceptar_recotizacion(uuid) y rechazar_recotizacion(uuid)
--     supabase/migrations/20260603120000_contrataciones_payments_flow.sql
--     (producción coincide con esa migración; #39 no las tocó)
--
-- Qué cambia respecto de esas funciones:
--   * Siempre queda pendiente de aceptación del cliente. #39 aplicaba sola
--     la recotización cuando la diferencia de costo de servicio no era positiva.
--   * Fundamentos obligatorios (10 a 1000 caracteres).
--   * Una sola pendiente por trabajo. El historial queda en public.recotizaciones.
--   * Solo el trabajador del trabajo, y solo si ya validó el PIN (estado en_curso
--     y un pin_intentos con exito).
--   * Rechazar NO acredita crédito ni finaliza el trabajo. Sigue el monto original
--     y el estado vuelve a en_curso. La versión anterior ponía finalizado y sumaba
--     el 90% de comision_app a saldo_credito.
--   * Aceptar copia precio_trabajador, precio_final y comision_app (esta última ya
--     pisada por el piso de #39: no baja de lo pagado). Si la diferencia de costo
--     de servicio es positiva, estado_pago vuelve a pendiente_seña para que el
--     checkout existente (mp_crear_preferencia, rama en_curso) cobre solo
--     comision_app − pagos Mercado Pago aprobados, tipo diferencia_seña.
--     Si no hay diferencia, estado_pago no se toca (no se fuerza seña_pagada ni
--     se baja un totalmente_pagado). No hay devolución.
--   * Mientras falte pagar la diferencia de una recotización aceptada
--     (en_curso + pendiente_seña), no se puede proponer otra ni marcar el
--     trabajo como realizado (trabajador_finalizar_trabajo, recreada desde
--     producción con ese único chequeo agregado).
--   * Facturación admin (_admin_billing_totals, admin_get_billing_stats,
--     admin_list_billing_rows; espejo en yachanga-admin, card #60): el DISTINCT ON
--     (contratacion_id, tipo_pago) se quedaba con la primera diferencia_seña
--     aprobada. Ahora cada pago de diferencia (por preferencia / pago de MP) suma.
--     seña_inicial sigue deduplicada igual que antes (#60), así que los totales
--     actuales no cambian. El costo de servicio sigue en los totales (#85).
--
-- La firma vieja recotizar_en_curso(uuid, numeric) se elimina para que no se
-- pueda proponer sin fundamentos.
--
-- Escrituras: solo estas RPC SECURITY DEFINER. La tabla de historial no tiene
-- INSERT/UPDATE/DELETE para anon ni authenticated, y un trigger corta igual
-- que #119 si alguien vuelve a dar el permiso.

ALTER TABLE public.contrataciones
  ADD COLUMN IF NOT EXISTS recotizacion_fundamentos text,
  ADD COLUMN IF NOT EXISTS recotizacion_id uuid;

COMMENT ON COLUMN public.contrataciones.recotizacion_fundamentos IS
  'Texto de la recotización pendiente. NULL cuando no hay una abierta.';
COMMENT ON COLUMN public.contrataciones.recotizacion_id IS
  'Fila pendiente de public.recotizaciones. NULL cuando no hay una abierta.';

GRANT SELECT (recotizacion_fundamentos, recotizacion_id)
  ON public.contrataciones TO authenticated;

CREATE TABLE IF NOT EXISTS public.recotizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratacion_id uuid NOT NULL REFERENCES public.contrataciones (id) ON DELETE CASCADE,
  worker_id uuid NOT NULL,
  client_id uuid NOT NULL,
  precio_trabajador_anterior numeric(12, 2) NOT NULL,
  precio_final_anterior numeric(12, 2) NOT NULL,
  comision_app_anterior numeric(12, 2) NOT NULL,
  precio_trabajador_nuevo numeric(12, 2) NOT NULL,
  precio_final_nuevo numeric(12, 2) NOT NULL,
  comision_app_nuevo numeric(12, 2) NOT NULL,
  fundamentos text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aceptada', 'rechazada')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT recotizaciones_fundamentos_len
    CHECK (char_length(btrim(fundamentos)) BETWEEN 10 AND 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS recotizaciones_una_pendiente
  ON public.recotizaciones (contratacion_id)
  WHERE estado = 'pendiente';

CREATE INDEX IF NOT EXISTS recotizaciones_contratacion_created
  ON public.recotizaciones (contratacion_id, created_at DESC);

ALTER TABLE public.recotizaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recotizaciones_select_participante ON public.recotizaciones;
CREATE POLICY recotizaciones_select_participante
  ON public.recotizaciones
  FOR SELECT
  TO authenticated
  USING (worker_id = auth.uid() OR client_id = auth.uid());

REVOKE ALL ON TABLE public.recotizaciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.recotizaciones TO authenticated;

CREATE OR REPLACE FUNCTION public.recotizaciones_block_direct_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'recotizaciones_direct_write_forbidden' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.recotizaciones_block_direct_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recotizaciones_block_direct_writes ON public.recotizaciones;
CREATE TRIGGER trg_recotizaciones_block_direct_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.recotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.recotizaciones_block_direct_writes();

-- ---------------------------------------------------------------------------
-- Proponer. Solo el trabajador, con PIN ya validado y fundamentos.
-- El piso de #39 (no devolver costo de servicio ya pagado) se conserva.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.recotizar_en_curso(uuid, numeric);

CREATE OR REPLACE FUNCTION public.recotizar_en_curso(
  p_contratacion_id uuid,
  p_nuevo_precio_trabajador numeric,
  p_fundamentos text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- #39: no hay devolución. El costo nuevo no baja de lo ya pagado.
  IF v_comision < v_pagado THEN
    v_precio_final := v_precio_final - v_comision + v_pagado;
    v_comision := v_pagado;
  END IF;

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
  RETURNING id INTO v_id;

  UPDATE public.contrataciones
  SET
    recotizacion_id = v_id,
    recotizacion_fundamentos = v_fundamentos,
    recotizacion_precio_trabajador = v_neto,
    recotizacion_precio_final = v_precio_final,
    recotizacion_comision_app = v_comision,
    estado_trabajo = 'pendiente_pago_diferencia'
  WHERE id = p_contratacion_id;

  v_monto_txt := '$' || to_char(v_neto, 'FM999999999');

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
      'precio_trabajador', v_neto
    )
  );
END;
$$;

COMMENT ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) IS
  'El trabajador, con PIN validado, propone un monto nuevo y fundamentos. Queda pendiente. No aplica el precio hasta que el cliente acepta. Costo de servicio con el piso de #39.';

REVOKE ALL ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Aceptar. Solo el cliente del trabajo. Impacta precios y, si corresponde,
-- deja la diferencia de costo de servicio para el checkout existente.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aceptar_recotizacion(p_contratacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
  v_pagado numeric;
  v_diff numeric;
  v_monto_txt text;
  v_diff_txt text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_row := public._assert_contratacion_participante(p_contratacion_id);

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede aceptar la recotización' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'pendiente_pago_diferencia'
     OR v_row.recotizacion_precio_trabajador IS NULL
     OR v_row.recotizacion_precio_final IS NULL
     OR v_row.recotizacion_comision_app IS NULL THEN
    RAISE EXCEPTION 'No hay recotización pendiente';
  END IF;

  SELECT coalesce(sum(monto), 0) INTO v_pagado
  FROM public.transacciones_pago
  WHERE contratacion_id = p_contratacion_id
    AND estado_mp = 'approved'
    AND tipo_pago IN ('seña_inicial', 'diferencia_seña');
  IF v_row.estado_pago IN ('seña_pagada', 'totalmente_pagado') THEN
    v_pagado := greatest(v_pagado, v_row.comision_app);
  END IF;

  v_diff := round(v_row.recotizacion_comision_app - v_pagado, 2);
  IF v_diff < 0 THEN
    v_diff := 0;
  END IF;

  UPDATE public.recotizaciones
  SET estado = 'aceptada', responded_at = now()
  WHERE contratacion_id = p_contratacion_id
    AND estado = 'pendiente';

  UPDATE public.contrataciones
  SET
    precio_trabajador = recotizacion_precio_trabajador,
    precio_final = recotizacion_precio_final,
    comision_app = recotizacion_comision_app,
    recotizacion_precio_trabajador = NULL,
    recotizacion_precio_final = NULL,
    recotizacion_comision_app = NULL,
    recotizacion_fundamentos = NULL,
    recotizacion_id = NULL,
    estado_trabajo = 'en_curso',
    estado_pago = CASE
      WHEN v_diff > 0 THEN 'pendiente_seña'::public.contratacion_estado_pago
      ELSE estado_pago
    END
  WHERE id = p_contratacion_id;

  v_monto_txt := '$' || to_char(ceil(v_row.recotizacion_precio_trabajador), 'FM999999999');
  v_diff_txt := '$' || to_char(ceil(v_diff), 'FM999999999');

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'Aceptaste la recotización. El pago al profesional pasa a ' || v_monto_txt || '.'
      || CASE
           WHEN v_diff > 0 THEN
             E'\n' || 'Falta pagar la diferencia del costo de servicio YaChanga (' || v_diff_txt || ') con Mercado Pago.'
           ELSE ''
         END,
    jsonb_build_object(
      'event', 'recotizacion_aceptada',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_row.recotizacion_id,
      'audience', 'cliente',
      'fundamentos', coalesce(v_row.recotizacion_fundamentos, ''),
      'precio_trabajador', v_row.recotizacion_precio_trabajador,
      'precio_final', v_row.recotizacion_precio_final,
      'comision_app', v_row.recotizacion_comision_app,
      'diferencia', v_diff
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'El cliente aceptó la recotización. Tu monto a cobrar pasa a ' || v_monto_txt || '.'
      || CASE
           WHEN v_diff > 0 THEN
             E'\n' || 'Cuando el cliente acredite la diferencia vas a poder marcarlo como realizado.'
           ELSE ''
         END,
    jsonb_build_object(
      'event', 'recotizacion_aceptada',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_row.recotizacion_id,
      'audience', 'trabajador',
      'fundamentos', coalesce(v_row.recotizacion_fundamentos, ''),
      'precio_trabajador', v_row.recotizacion_precio_trabajador
    )
  );
END;
$$;

COMMENT ON FUNCTION public.aceptar_recotizacion(uuid) IS
  'El cliente acepta la recotización pendiente. Actualiza precio_trabajador, precio_final y comision_app. Si falta costo de servicio, deja pendiente_seña para el checkout existente.';

REVOKE ALL ON FUNCTION public.aceptar_recotizacion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aceptar_recotizacion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.aceptar_recotizacion(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rechazar. El monto original no se toca. El trabajo sigue en curso.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rechazar_recotizacion(p_contratacion_id uuid)
RETURNS void
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

  v_row := public._assert_contratacion_participante(p_contratacion_id);

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede rechazar la recotización' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'pendiente_pago_diferencia'
     OR v_row.recotizacion_precio_trabajador IS NULL THEN
    RAISE EXCEPTION 'No hay recotización pendiente';
  END IF;

  UPDATE public.recotizaciones
  SET estado = 'rechazada', responded_at = now()
  WHERE contratacion_id = p_contratacion_id
    AND estado = 'pendiente';

  UPDATE public.contrataciones
  SET
    recotizacion_precio_trabajador = NULL,
    recotizacion_precio_final = NULL,
    recotizacion_comision_app = NULL,
    recotizacion_fundamentos = NULL,
    recotizacion_id = NULL,
    estado_trabajo = 'en_curso'
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'Rechazaste la recotización. El trabajo sigue con el monto original.',
    jsonb_build_object(
      'event', 'recotizacion_rechazada',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_row.recotizacion_id,
      'audience', 'cliente',
      'fundamentos', coalesce(v_row.recotizacion_fundamentos, ''),
      'precio_trabajador', v_row.precio_trabajador,
      'precio_final', v_row.precio_final,
      'comision_app', v_row.comision_app
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'El cliente rechazó la recotización. El trabajo sigue con el monto original.',
    jsonb_build_object(
      'event', 'recotizacion_rechazada',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_row.recotizacion_id,
      'audience', 'trabajador',
      'fundamentos', coalesce(v_row.recotizacion_fundamentos, ''),
      'precio_trabajador', v_row.precio_trabajador
    )
  );
END;
$$;

COMMENT ON FUNCTION public.rechazar_recotizacion(uuid) IS
  'El cliente rechaza la recotización pendiente. No cambia precios, no acredita crédito y no finaliza el trabajo.';

REVOKE ALL ON FUNCTION public.rechazar_recotizacion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rechazar_recotizacion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rechazar_recotizacion(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Marcar realizado. Cuerpo de producción (pg_get_functiondef 2026-10-02) con un
-- único chequeo nuevo: no se puede mientras falte la diferencia de costo de servicio.
-- CREATE OR REPLACE conserva los grants (#100: authenticated y service_role).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trabajador_finalizar_trabajo(p_contratacion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- #4: con una recotización aceptada que subió el costo de servicio, primero
  -- tiene que acreditarse la diferencia (el PIN exige seña pagada, así que
  -- en_curso + pendiente_seña solo pasa por una recotización).
  IF v_row.estado_pago = 'pendiente_seña' THEN
    RAISE EXCEPTION 'Falta que el cliente pague la diferencia del costo de servicio';
  END IF;

  UPDATE public.contrataciones
  SET
    estado_trabajo = 'pendiente_conformidad',
    conformidad_solicitada_at = now(),
    completed_by_worker_at = now(),
    conformidad_aceptada = NULL,
    conformidad_respondida_at = NULL
  WHERE id = p_contratacion_id;

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional marcó el trabajo como finalizado. ¿Quedó bien? Confirmá o indicá que tuviste un problema.',
    jsonb_build_object(
      'event', 'conformidad_solicitada',
      'contratacion_id', p_contratacion_id,
      'audience', 'cliente'
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Marcaste el trabajo como finalizado. Esperamos la conformidad del cliente.',
    jsonb_build_object(
      'event', 'trabajo_finalizado',
      'contratacion_id', p_contratacion_id,
      'audience', 'trabajador'
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Pago acreditado (solo service_role: webhook / confirmación MP). Cuerpo de
-- producción (= supabase/migrations/20261001190000_copy_costo_servicio_y_conformidad.sql)
-- con un solo cambio: si lo pagado es la diferencia de una recotización, el chat
-- no repite el texto de la seña inicial (PIN y dirección). Mismos eventos; la
-- metadata suma tipo_pago para el push. El estado y los montos no cambian.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public."registrar_seña_aprobada"(p_contratacion_id uuid, p_tipo_pago transaccion_tipo_pago, p_monto numeric, p_mp_payment_id text, p_mp_preference_id text, p_idempotency_key text, p_external_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_was_pending boolean;
  v_mp_id text := nullif(btrim(coalesce(p_mp_payment_id, '')), '');
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

  v_was_pending := v_row.estado_pago = 'pendiente_seña';

  BEGIN
    WITH target AS (
      SELECT t2.id
      FROM public.transacciones_pago t2
      WHERE t2.contratacion_id = p_contratacion_id
        AND t2.tipo_pago = p_tipo_pago
        AND t2.estado_mp IS DISTINCT FROM 'approved'
        AND (
          t2.mp_payment_id IS NULL
          OR btrim(t2.mp_payment_id) = ''
          OR v_mp_id IS NULL
          OR t2.mp_payment_id = v_mp_id
        )
        AND NOT (
          v_mp_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.transacciones_pago t3
            WHERE t3.contratacion_id = p_contratacion_id
              AND t3.tipo_pago = p_tipo_pago
              AND t3.estado_mp = 'approved'
              AND t3.mp_payment_id = v_mp_id
          )
        )
      ORDER BY t2.created_at DESC
      LIMIT 1
    ),
    upd AS (
      UPDATE public.transacciones_pago t
      SET
        estado_mp = 'approved',
        monto = p_monto,
        mp_payment_id = coalesce(v_mp_id, nullif(btrim(coalesce(t.mp_payment_id, '')), '')),
        mp_preference_id = coalesce(nullif(p_mp_preference_id, ''), t.mp_preference_id),
        external_reference = coalesce(nullif(p_external_reference, ''), t.external_reference),
        updated_at = now()
      FROM target
      WHERE t.id = target.id
      RETURNING t.id
    )
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
    SELECT
      p_contratacion_id,
      v_row.client_id,
      p_tipo_pago,
      p_monto,
      'approved',
      v_mp_id,
      p_mp_preference_id,
      p_idempotency_key,
      p_external_reference
    WHERE NOT EXISTS (SELECT 1 FROM upd)
      AND NOT (
        v_mp_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.transacciones_pago t3
          WHERE t3.contratacion_id = p_contratacion_id
            AND t3.tipo_pago = p_tipo_pago
            AND t3.estado_mp = 'approved'
            AND t3.mp_payment_id = v_mp_id
        )
      )
    ON CONFLICT DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  IF v_was_pending THEN
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

    BEGIN
      PERFORM public._chat_insert_system_event(
        v_row.conversation_id,
        v_row.client_id,
        CASE
          WHEN p_tipo_pago = 'diferencia_seña' THEN
            '✅ Diferencia del costo de servicio YaChanga pagada.' || E'\n\n'
              || 'El trabajo sigue en curso con el monto nuevo. El saldo restante se paga directo al profesional, fuera de la app.'
          ELSE
            '✅ Costo de servicio YaChanga pagado.' || E'\n\n'
              || 'Tu PIN de seguridad fue generado. Por seguridad, dáselo al profesional '
              || 'únicamente cuando llegue a tu domicilio.' || E'\n\n'
              || 'La dirección de tu domicilio se compartió con el profesional para que pueda asistir.' || E'\n\n'
              || 'El saldo restante del trabajo se paga directo al profesional, fuera de la app. No genera comprobante de Mercado Pago.'
        END,
        jsonb_build_object(
          'event', 'seña_pagada_cliente',
          'contratacion_id', p_contratacion_id,
          'audience', 'cliente',
          'tipo_pago', p_tipo_pago::text
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'registrar_seña chat cliente: %', SQLERRM;
    END;

    BEGIN
      PERFORM public._chat_insert_system_event(
        v_row.conversation_id,
        v_row.worker_id,
        CASE
          WHEN p_tipo_pago = 'diferencia_seña' THEN
            'El cliente pagó la diferencia del costo de servicio. Ya podés marcar el trabajo como realizado.'
          ELSE
            'El costo de servicio YaChanga fue pagado. Al llegar al domicilio, pedile el PIN al cliente. El saldo restante te lo paga el cliente directo, fuera de la app.'
        END,
        jsonb_build_object(
          'event', 'seña_pagada_trabajador',
          'contratacion_id', p_contratacion_id,
          'audience', 'trabajador',
          'tipo_pago', p_tipo_pago::text
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'registrar_seña chat trabajador: %', SQLERRM;
    END;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Facturación admin. Cuerpos de producción (= yachanga-admin card #60) con un
-- solo cambio: la clave del DISTINCT ON de pagos de servicio. seña_inicial sigue
-- con (contratacion_id, tipo_pago) como en #60; diferencia_seña además separa por
-- preferencia / pago de MP, así cada diferencia pagada suma una vez.
-- CREATE OR REPLACE conserva los grants (#100).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._admin_billing_totals(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'yachanga_service_fees', coalesce((
      SELECT sum(d.monto)
      FROM (
        SELECT DISTINCT ON (t.contratacion_id, t.tipo_pago,
          CASE WHEN t.tipo_pago::text = 'diferencia_seña'
            THEN coalesce(nullif(btrim(t.mp_preference_id), ''), nullif(btrim(t.mp_payment_id), ''), t.id::text)
            ELSE '' END)
          t.monto
        FROM public.transacciones_pago t
        WHERE t.estado_mp::text = 'approved'
          AND t.contratacion_id IS NOT NULL
          AND t.tipo_pago::text IN ('seña_inicial', 'diferencia_seña')
          AND (p_from IS NULL OR t.created_at >= p_from)
          AND (p_to IS NULL OR t.created_at < p_to)
        ORDER BY t.contratacion_id, t.tipo_pago,
          CASE WHEN t.tipo_pago::text = 'diferencia_seña'
            THEN coalesce(nullif(btrim(t.mp_preference_id), ''), nullif(btrim(t.mp_payment_id), ''), t.id::text)
            ELSE '' END,
          t.created_at ASC, t.id ASC
      ) d
    ), 0),
    'yachanga_material_fees', coalesce((
      SELECT sum(d.monto)
      FROM (
        SELECT DISTINCT ON (t.material_order_id)
          t.monto
        FROM public.transacciones_pago t
        WHERE t.estado_mp::text = 'approved'
          AND t.tipo_pago::text = 'seña_materiales'
          AND t.material_order_id IS NOT NULL
          AND (p_from IS NULL OR t.created_at >= p_from)
          AND (p_to IS NULL OR t.created_at < p_to)
        ORDER BY t.material_order_id, t.created_at ASC, t.id ASC
      ) d
    ), 0),
    'worker_theoretical_income', coalesce((
      SELECT sum(c.precio_trabajador)
      FROM public.contrataciones c
      WHERE c.estado_trabajo::text = 'finalizado'
        AND (p_from IS NULL OR coalesce(c.finalizado_at, c.updated_at) >= p_from)
        AND (p_to IS NULL OR coalesce(c.finalizado_at, c.updated_at) < p_to)
    ), 0),
    'store_material_income', coalesce((
      SELECT sum(o.accepted_total)
      FROM public.orders o
      WHERE (
        o.deposit_status IN ('paid', 'waived')
        OR o.status IN ('deposit_paid', 'completed')
      )
        AND (p_from IS NULL OR coalesce(o.contact_revealed_at, o.updated_at, o.created_at) >= p_from)
        AND (p_to IS NULL OR coalesce(o.contact_revealed_at, o.updated_at, o.created_at) < p_to)
    ), 0)
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_billing_rows(p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text, p_kind text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_from timestamptz := public._admin_range_start(p_from);
  v_to timestamptz := public._admin_range_end(p_to);
  v_kind text := lower(btrim(coalesce(p_kind, 'all')));
  v_rows jsonb;
BEGIN
  PERFORM public._admin_require();
  IF v_kind NOT IN ('all', 'servicio', 'materiales') THEN
    v_kind := 'all';
  END IF;

  WITH service_tx AS (
    SELECT DISTINCT ON (t.contratacion_id, t.tipo_pago,
          CASE WHEN t.tipo_pago::text = 'diferencia_seña'
            THEN coalesce(nullif(btrim(t.mp_preference_id), ''), nullif(btrim(t.mp_payment_id), ''), t.id::text)
            ELSE '' END)
      t.*
    FROM public.transacciones_pago t
    WHERE t.estado_mp::text = 'approved'
      AND t.tipo_pago::text IN ('seña_inicial', 'diferencia_seña')
      AND (v_from IS NULL OR t.created_at >= v_from)
      AND (v_to IS NULL OR t.created_at < v_to)
      AND v_kind IN ('all', 'servicio')
    ORDER BY t.contratacion_id, t.tipo_pago,
          CASE WHEN t.tipo_pago::text = 'diferencia_seña'
            THEN coalesce(nullif(btrim(t.mp_preference_id), ''), nullif(btrim(t.mp_payment_id), ''), t.id::text)
            ELSE '' END,
          t.created_at ASC, t.id ASC
  ),
  material_tx AS (
    SELECT DISTINCT ON (t.material_order_id)
      t.*
    FROM public.transacciones_pago t
    WHERE t.estado_mp::text = 'approved'
      AND t.tipo_pago::text = 'seña_materiales'
      AND t.material_order_id IS NOT NULL
      AND (v_from IS NULL OR t.created_at >= v_from)
      AND (v_to IS NULL OR t.created_at < v_to)
      AND v_kind IN ('all', 'materiales')
    ORDER BY t.material_order_id, t.created_at ASC, t.id ASC
  ),
  lines AS (
    SELECT
      'servicio'::text AS kind,
      t.id AS ref_id,
      t.created_at AS occurred_at,
      t.monto AS yachanga_fee,
      c.precio_trabajador AS counterparty_amount,
      c.precio_final AS total_amount,
      public._admin_full_name(pc.nombre, pc.apellido) AS client_name,
      coalesce(uc.email, '') AS client_email,
      coalesce(pc.telefono, '') AS client_phone,
      coalesce(pc.dni, '') AS client_dni,
      public._admin_full_name(pw.nombre, pw.apellido) AS professional_name,
      coalesce(uw.email, '') AS professional_email,
      coalesce(pw.telefono, '') AS professional_phone,
      coalesce(pw.dni, '') AS professional_dni,
      NULL::text AS store_name,
      NULL::text AS store_phone,
      t.estado_mp::text AS status
    FROM service_tx t
    JOIN public.contrataciones c ON c.id = t.contratacion_id
    LEFT JOIN public.profiles pc ON pc.id = c.client_id
    LEFT JOIN auth.users uc ON uc.id = c.client_id
    LEFT JOIN public.profiles pw ON pw.id = c.worker_id
    LEFT JOIN auth.users uw ON uw.id = c.worker_id

    UNION ALL

    SELECT
      'materiales',
      t.id,
      t.created_at,
      t.monto,
      o.accepted_total,
      o.accepted_total + t.monto,
      public._admin_full_name(pc.nombre, pc.apellido),
      coalesce(uc.email, ''),
      coalesce(pc.telefono, ''),
      coalesce(pc.dni, ''),
      public._admin_full_name(pp.nombre, pp.apellido),
      coalesce(up.email, ''),
      coalesce(pp.telefono, ''),
      coalesce(pp.dni, ''),
      s.name,
      coalesce(s.phone, ''),
      t.estado_mp::text
    FROM material_tx t
    JOIN public.orders o ON o.id = t.material_order_id
    LEFT JOIN public.quotes q ON q.id = o.quote_id
    LEFT JOIN public.stores s ON s.id = q.store_id
    LEFT JOIN public.material_requests mr ON mr.id = q.request_id
    LEFT JOIN public.profiles pc ON pc.id = coalesce(o.client_id, mr.client_id)
    LEFT JOIN auth.users uc ON uc.id = coalesce(o.client_id, mr.client_id)
    LEFT JOIN public.profiles pp ON pp.id = mr.professional_id
    LEFT JOIN auth.users up ON up.id = mr.professional_id
  )
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.occurred_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT * FROM lines
    ORDER BY occurred_at DESC
    LIMIT 2000
  ) l;

  RETURN jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_billing_stats(p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := public._admin_range_start(p_from);
  v_to timestamptz := public._admin_range_end(p_to);
  v_hist jsonb;
  v_period jsonb;
  v_months jsonb;
BEGIN
  PERFORM public._admin_require();

  v_hist := public._admin_billing_totals(NULL, NULL);
  v_period := public._admin_billing_totals(v_from, v_to);
  v_period := v_period || jsonb_build_object(
    'from', v_from,
    'to', CASE WHEN v_to IS NULL THEN NULL ELSE v_to - interval '1 second' END
  );
  v_hist := v_hist || jsonb_build_object(
    'yachanga_total',
    (v_hist->>'yachanga_service_fees')::numeric + (v_hist->>'yachanga_material_fees')::numeric
  );
  v_period := v_period || jsonb_build_object(
    'yachanga_total',
    (v_period->>'yachanga_service_fees')::numeric + (v_period->>'yachanga_material_fees')::numeric
  );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'mes', s.mes,
    'service_fees', s.service_fees,
    'material_fees', s.material_fees,
    'worker_income', s.worker_income,
    'store_income', s.store_income
  ) ORDER BY s.mes), '[]'::jsonb)
  INTO v_months
  FROM (
    SELECT
      mes,
      sum(service_fees) AS service_fees,
      sum(material_fees) AS material_fees,
      sum(worker_income) AS worker_income,
      sum(store_income) AS store_income
    FROM (
      SELECT to_char(date_trunc('month', timezone('America/Argentina/Buenos_Aires', t.created_at)), 'YYYY-MM') AS mes,
             t.monto AS service_fees, 0::numeric AS material_fees,
             0::numeric AS worker_income, 0::numeric AS store_income
      FROM (
        SELECT DISTINCT ON (tp.contratacion_id, tp.tipo_pago,
          CASE WHEN tp.tipo_pago::text = 'diferencia_seña'
            THEN coalesce(nullif(btrim(tp.mp_preference_id), ''), nullif(btrim(tp.mp_payment_id), ''), tp.id::text)
            ELSE '' END)
          tp.created_at, tp.monto
        FROM public.transacciones_pago tp
        WHERE tp.estado_mp::text = 'approved'
          AND tp.contratacion_id IS NOT NULL
          AND tp.tipo_pago::text IN ('seña_inicial', 'diferencia_seña')
          AND (v_from IS NULL OR tp.created_at >= v_from)
          AND (v_to IS NULL OR tp.created_at < v_to)
        ORDER BY tp.contratacion_id, tp.tipo_pago,
          CASE WHEN tp.tipo_pago::text = 'diferencia_seña'
            THEN coalesce(nullif(btrim(tp.mp_preference_id), ''), nullif(btrim(tp.mp_payment_id), ''), tp.id::text)
            ELSE '' END,
          tp.created_at ASC, tp.id ASC
      ) t
      UNION ALL
      SELECT to_char(date_trunc('month', timezone('America/Argentina/Buenos_Aires', t.created_at)), 'YYYY-MM'),
             0, t.monto, 0, 0
      FROM (
        SELECT DISTINCT ON (tp.material_order_id)
          tp.created_at, tp.monto
        FROM public.transacciones_pago tp
        WHERE tp.estado_mp::text = 'approved'
          AND tp.tipo_pago::text = 'seña_materiales'
          AND tp.material_order_id IS NOT NULL
          AND (v_from IS NULL OR tp.created_at >= v_from)
          AND (v_to IS NULL OR tp.created_at < v_to)
        ORDER BY tp.material_order_id, tp.created_at ASC, tp.id ASC
      ) t
      UNION ALL
      SELECT to_char(date_trunc('month', timezone('America/Argentina/Buenos_Aires', coalesce(c.finalizado_at, c.updated_at))), 'YYYY-MM'),
             0, 0, c.precio_trabajador, 0
      FROM public.contrataciones c
      WHERE c.estado_trabajo::text = 'finalizado'
        AND (v_from IS NULL OR coalesce(c.finalizado_at, c.updated_at) >= v_from)
        AND (v_to IS NULL OR coalesce(c.finalizado_at, c.updated_at) < v_to)
      UNION ALL
      SELECT to_char(date_trunc('month', timezone('America/Argentina/Buenos_Aires', coalesce(o.contact_revealed_at, o.updated_at, o.created_at))), 'YYYY-MM'),
             0, 0, 0, o.accepted_total
      FROM public.orders o
      WHERE (o.deposit_status IN ('paid', 'waived') OR o.status IN ('deposit_paid', 'completed'))
        AND (v_from IS NULL OR coalesce(o.contact_revealed_at, o.updated_at, o.created_at) >= v_from)
        AND (v_to IS NULL OR coalesce(o.contact_revealed_at, o.updated_at, o.created_at) < v_to)
    ) u
    GROUP BY mes
  ) s;

  RETURN jsonb_build_object(
    'historico', v_hist,
    'periodo', v_period,
    'por_mes', coalesce(v_months, '[]'::jsonb)
  );
END;
$function$;

-- Verificación de permisos. Si algo quedó abierto, la transacción falla.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.recotizar_en_curso(uuid, numeric, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no debe ejecutar recotizar_en_curso';
  END IF;
  IF has_function_privilege('anon', 'public.aceptar_recotizacion(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no debe ejecutar aceptar_recotizacion';
  END IF;
  IF has_function_privilege('anon', 'public.rechazar_recotizacion(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no debe ejecutar rechazar_recotizacion';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public'
      AND p.proname = 'recotizar_en_curso'
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC no debe ejecutar recotizar_en_curso';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'recotizar_en_curso'
      AND pg_get_function_identity_arguments(p.oid) = 'p_contratacion_id uuid, p_nuevo_precio_trabajador numeric'
  ) THEN
    RAISE EXCEPTION 'quedó la firma vieja de recotizar_en_curso';
  END IF;
  IF has_table_privilege('authenticated', 'public.recotizaciones', 'INSERT')
     OR has_table_privilege('authenticated', 'public.recotizaciones', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.recotizaciones', 'DELETE')
     OR has_table_privilege('anon', 'public.recotizaciones', 'INSERT') THEN
    RAISE EXCEPTION 'anon/authenticated no deben escribir recotizaciones';
  END IF;
END;
$$;
