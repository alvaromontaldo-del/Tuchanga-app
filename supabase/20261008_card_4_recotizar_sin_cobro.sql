-- YaChanga #4 — Recotizar, opción A: el cliente no paga nada más.
--
-- NO APLICADO en producción. Dry-run con BEGIN…ROLLBACK el 2026-10-08
-- sobre la contratación 34e896fa-f20a-480b-833e-29b2025e1c99
-- (neto 25000, comisión ya pagada 5500; tramo de 80000 = 6800 y de 10000 = 5000):
-- subir congela la comisión en 5500 y aceptar no pasa a pendiente_seña;
-- bajar tampoco devuelve; rechazar deja el monto aceptado; la segunda
-- pendiente queda bloqueada. Tras el ROLLBACK la fila, el trigger de push
-- y las funciones vivas quedaron como estaban.
--
-- Cuerpos reconstruidos con pg_get_functiondef el 2026-10-08
-- (kyxehrxcdealbujvvnxp), después de card_207_miles:
--   public.recotizar_en_curso(uuid, numeric, text)
--   public.aceptar_recotizacion(uuid)
--
-- Cambios respecto del cuerpo vivo:
--   * recotizar_en_curso congela comision_app en lo ya pagado (no baja, #39,
--     y tampoco sube). precio_final = neto + esa comisión.
--   * El metadata de la propuesta incluye precio_trabajador_anterior.
--   * aceptar_recotizacion copia esos montos y no toca estado_pago: nunca
--     vuelve a pendiente_seña. El chat y el metadata ya no dicen que falta
--     pagar una diferencia.
--   * Se conserva el separador de miles de #207 (regexp_replace, no
--     FM999999999) y los guards (PIN, fundamentos, una sola pendiente,
--     pendiente_seña, worker_on_leave no vive acá).
--
-- No hay GRANT: CREATE OR REPLACE conserva los privilegios actuales
-- (authenticated y service_role; anon no tiene EXECUTE).
-- rechazar_recotizacion no cambia.

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

  -- #4 opción A: el cliente no paga nada más, ni la diferencia del costo de
  -- servicio. #39 sigue vigente: tampoco hay devolución. La comisión queda
  -- en lo ya pagado aunque el tramo nuevo sea más alto.
  v_precio_final := v_precio_final - v_comision + v_pagado;
  v_comision := v_pagado;

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
      'precio_trabajador_anterior', v_row.precio_trabajador,
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
      'precio_trabajador_anterior', v_row.precio_trabajador,
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

  IF v_row.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el cliente puede aceptar la recotización' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'pendiente_pago_diferencia'
     OR v_row.recotizacion_precio_trabajador IS NULL
     OR v_row.recotizacion_precio_final IS NULL
     OR v_row.recotizacion_comision_app IS NULL THEN
    RAISE EXCEPTION 'No hay recotización pendiente';
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
    estado_trabajo = 'en_curso'
  WHERE id = p_contratacion_id;

  v_monto_txt := '$' || regexp_replace(trunc(ceil(v_row.recotizacion_precio_trabajador))::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'Aceptaste la recotización. El pago al profesional pasa a ' || v_monto_txt || '.'
      || E'\n' || 'No se paga ningún costo adicional.',
    jsonb_build_object(
      'event', 'recotizacion_aceptada',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_row.recotizacion_id,
      'audience', 'cliente',
      'fundamentos', coalesce(v_row.recotizacion_fundamentos, ''),
      'precio_trabajador', v_row.recotizacion_precio_trabajador,
      'precio_final', v_row.recotizacion_precio_final,
      'comision_app', v_row.recotizacion_comision_app
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.client_id,
    'El cliente aceptó la recotización. Tu monto a cobrar pasa a ' || v_monto_txt || '.',
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

COMMENT ON FUNCTION public.aceptar_recotizacion(uuid) IS
  'El cliente acepta la recotización pendiente. Actualiza precio_trabajador, precio_final y comision_app (congelada en lo ya pagado). No cambia estado_pago: nunca vuelve a pendiente_seña.';

COMMIT;
