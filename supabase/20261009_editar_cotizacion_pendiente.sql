-- YaChanga #207 — el trabajador edita la cotización enviada mientras el
-- cliente no la aceptó.
--
-- NO APLICADO en producción. Probar con BEGIN … ROLLBACK.
-- Cuerpo nuevo, con los mismos guards de monto, detalle y garantía que
-- public.crear_cotizacion(uuid, numeric, text, integer) vivo
-- (pg_get_functiondef, 2026-10-09, kyxehrxcdealbujvvnxp).
-- No se toca crear_cotizacion, recotizar_en_curso ni sus grants.
--
-- Quién: solo el trabajador dueño de la fila (worker_id = auth.uid()).
-- Cuándo: estado_trabajo = precio_cotizado (pendiente de aceptación).
-- SECURITY DEFINER. EXECUTE para authenticated y service_role. Nunca anon.
--
-- El profesional no recibe un aviso con el desglose: no se inserta mensaje
-- de sistema. Se actualiza la fila y el metadata de la tarjeta quotation
-- que ya ve el cliente (igual que crear_cotizacion). La app del profesional
-- sigue mostrando solo el monto a cobrar.
-- Dry-run 2026-10-09 (BEGIN … ROLLBACK, datos reales, sin COMMIT):
-- el dueño pasa 300000 a neto 300000 / final 317000 / fee 17000 / garantía 15;
-- cliente, ajeno y sin sesión no pueden; detalle vacío, garantía 61, monto 0
-- y estado precio_aceptado tampoco; ceil(300000.2) = 300001 y garantía 0 → null;
-- anon no tiene EXECUTE; la tarjeta material_quote no se toca.
-- Tras el ROLLBACK la función no quedó en producción.

CREATE OR REPLACE FUNCTION public.editar_cotizacion(
  p_contratacion_id uuid,
  p_precio_trabajador numeric,
  p_service_detail text DEFAULT ''::text,
  p_warranty_days integer DEFAULT NULL::integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_precios record;
  v_detail text;
  v_neto numeric;
  v_warranty_days integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización inexistente';
  END IF;

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede editar la cotización' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'precio_cotizado' THEN
    RAISE EXCEPTION 'Solo se puede editar un presupuesto pendiente';
  END IF;

  v_detail := coalesce(trim(p_service_detail), '');
  IF v_detail = '' THEN
    RAISE EXCEPTION 'El detalle del servicio es obligatorio';
  END IF;

  IF p_warranty_days IS NULL OR p_warranty_days <= 0 THEN
    v_warranty_days := NULL;
  ELSIF p_warranty_days > 60 THEN
    RAISE EXCEPTION 'Los días de garantía deben ser entre 1 y 60';
  ELSE
    v_warranty_days := p_warranty_days;
  END IF;

  v_neto := ceil(p_precio_trabajador);
  IF v_neto IS NULL OR v_neto <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);

  UPDATE public.contrataciones
  SET
    precio_trabajador = v_neto,
    precio_final = v_precios.precio_final,
    comision_app = v_precios.comision_app,
    service_detail = v_detail,
    warranty_days = v_warranty_days
  WHERE id = p_contratacion_id;

  -- La tarjeta del chat. No es un mensaje nuevo y no nombra el costo de servicio.
  UPDATE public.messages
  SET
    body = v_detail,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'contratacion_id', p_contratacion_id,
      'precio_final', v_precios.precio_final,
      'precio_trabajador', v_neto,
      'service_detail', v_detail,
      'warranty_days', v_warranty_days
    )
  WHERE conversation_id = v_row.conversation_id
    AND type = 'quotation'
    AND coalesce(metadata->>'kind', '') IS DISTINCT FROM 'material_quote'
    AND (
      metadata->>'contratacion_id' = p_contratacion_id::text
      OR metadata->>'quoteId' = p_contratacion_id::text
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) TO service_role;
