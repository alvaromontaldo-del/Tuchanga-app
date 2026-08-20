-- Cotización en pesos enteros: precio_final y comision_app con CEIL (redondeo hacia arriba).

CREATE OR REPLACE FUNCTION public.calc_precios_contratacion(p_precio_trabajador numeric)
RETURNS TABLE (precio_final numeric, comision_app numeric)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_neto numeric;
  v_final numeric;
  v_comision numeric;
BEGIN
  IF p_precio_trabajador IS NULL OR p_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;

  -- Neto en entero (hacia arriba por si viene con decimales).
  v_neto := ceil(p_precio_trabajador);
  -- Precio final = neto / (1 - 0.22), siempre entero hacia arriba.
  v_final := ceil(v_neto / (1 - 0.22));
  v_comision := v_final - v_neto;

  RETURN QUERY SELECT v_final, v_comision;
END;
$$;

COMMENT ON FUNCTION public.calc_precios_contratacion(numeric) IS
  'Calcula precio_final y comision_app (22%) en pesos enteros con CEIL.';

-- Asegurar que crear_cotizacion persista neto entero (alineado al cálculo).
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
  v_neto numeric;
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

  v_neto := ceil(p_precio_trabajador);
  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);
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
    v_neto,
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
      'precio_trabajador', v_neto
    )
  );

  RETURN v_id;
END;
$$;
