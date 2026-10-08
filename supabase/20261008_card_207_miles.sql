-- YaChanga #207 — separador de miles en los textos de recotización.
--
-- APLICADO en producción el 2026-10-08 como migration `card_207_miles`
-- (dry-run BEGIN…ROLLBACK previo sobre un trabajo real: mismos montos, solo cambia el texto).
-- Cuerpos reconstruidos con pg_get_functiondef el 2026-10-08
-- (kyxehrxcdealbujvvnxp), firmas:
--   public.recotizar_en_curso(uuid, numeric, text)
--   public.aceptar_recotizacion(uuid)
--
-- Único cambio respecto del cuerpo vivo: las tres asignaciones de texto
-- v_monto_txt / v_diff_txt. Antes: to_char(..., 'FM999999999') → "300000".
-- Ahora un regexp sobre el entero, que no depende de lc_numeric
-- (en esta base está en en_US.UTF-8; la coma de to_char sí cambia con el locale).
-- Verificado en solo lectura: 300000 → 300.000, 1000 → 1.000, 65000 → 65.000.
--
-- No se toca la lógica de #4 (PIN, guards, piso de comisión, estados,
-- audiences ni el jsonb). No hay GRANT: CREATE OR REPLACE conserva los
-- privilegios actuales (authenticated y service_role; anon no tiene EXECUTE).

BEGIN;

CREATE OR REPLACE FUNCTION public.recotizar_en_curso(p_contratacion_id uuid, p_nuevo_precio_trabajador numeric, p_fundamentos text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_monto_txt := '$' || regexp_replace(trunc(v_neto)::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');

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
$function$;

CREATE OR REPLACE FUNCTION public.aceptar_recotizacion(p_contratacion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_monto_txt := '$' || regexp_replace(trunc(ceil(v_row.recotizacion_precio_trabajador))::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');
  v_diff_txt := '$' || regexp_replace(trunc(ceil(v_diff))::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');

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
$function$;

COMMIT;
