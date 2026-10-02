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
--   * La facturación admin (_admin_billing_totals) suma transacciones aprobadas
--     de seña_inicial y diferencia_seña. La diferencia entra cuando el cliente
--     la paga. No se recrea esa función: no está en el repo.
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
    RAISE EXCEPTION 'Solo el trabajador puede recotizar';
  END IF;

  IF v_row.estado_trabajo <> 'en_curso' THEN
    RAISE EXCEPTION 'Solo se puede recotizar con trabajo en curso';
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
    RAISE EXCEPTION 'Solo el cliente puede aceptar la recotización';
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
    RAISE EXCEPTION 'Solo el cliente puede rechazar la recotización';
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
