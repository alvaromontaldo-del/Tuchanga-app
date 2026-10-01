-- Card #39. Costo de servicio al contratar un profesional: tramos marginales.
--
-- NO aplicar en producción desde el agente: lo aplica un revisor.
--
-- Fuente de calc_precios_contratacion: pg_get_functiondef en producción
-- (proyecto kyxehrxcdealbujvvnxp, 2026-10-01). Coincidía con
-- supabase/migrations/20260818180000_mp_payment_required_and_quote_detail.sql.
-- Las migraciones del repo pueden estar atrasadas: diffear este archivo contra prod.
--
-- Único cambio en calc_precios_contratacion: la comisión sale de
-- public.calc_yachanga_service_fee en lugar de CEIL(neto * 0.22).
-- Se conservan el guard (precio NULL o <= 0), IMMUTABLE, el CEIL del neto
-- y precio_final = neto + comisión.
--
-- No hay UPDATE de contrataciones. comision_app y precio_final quedan
-- guardados al cotizar (crear_cotizacion) o al recotizar (recotizar_en_curso).
-- Las filas ya creadas no se recalculan.
--
-- calculate_material_service_fee no se toca. Materiales sigue en su función.

CREATE OR REPLACE FUNCTION public.calc_yachanga_service_fee(p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  -- Una sola config. La lógica no repite pisos, topes ni tasas.
  v_cfg constant jsonb := jsonb_build_object(
    'floor', 5000,
    'cap', 23000,
    'ceil_to_peso', true,
    'rate_denominator', 10000,
    'tiers', jsonb_build_array(
      jsonb_build_object('up_to', 50000, 'rate_numerator', 1000),
      jsonb_build_object('up_to', 200000, 'rate_numerator', 600),
      jsonb_build_object('up_to', 500000, 'rate_numerator', 300)
    )
  );
  v_floor numeric := (v_cfg->>'floor')::numeric;
  v_cap numeric := (v_cfg->>'cap')::numeric;
  v_ceil boolean := coalesce((v_cfg->>'ceil_to_peso')::boolean, false);
  v_den numeric := (v_cfg->>'rate_denominator')::numeric;
  v_tiers jsonb := v_cfg->'tiers';
  v_n integer := jsonb_array_length(v_tiers);
  v_i integer;
  v_tier jsonb;
  v_up_to numeric;
  v_num numeric;
  v_cursor numeric := 0;
  v_portion numeric;
  v_scaled numeric := 0;
  v_fee numeric;
  v_last_up_to numeric;
BEGIN
  -- En numeric, NaN = NaN y NaN es mayor que cualquier monto: hay que cortarlo acá.
  IF p_amount IS NULL OR p_amount = 'NaN'::numeric THEN
    RAISE EXCEPTION 'monto inválido: debe ser numérico';
  END IF;
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'monto inválido: no puede ser negativo';
  END IF;

  IF v_n = 0 THEN
    RETURN v_floor;
  END IF;

  v_last_up_to := (v_tiers->(v_n - 1)->>'up_to')::numeric;
  IF p_amount > v_last_up_to THEN
    RETURN v_cap;
  END IF;

  FOR v_i IN 0..(v_n - 1) LOOP
    v_tier := v_tiers->v_i;
    v_up_to := (v_tier->>'up_to')::numeric;
    v_num := (v_tier->>'rate_numerator')::numeric;
    EXIT WHEN p_amount <= v_cursor;
    v_portion := least(p_amount, v_up_to) - v_cursor;
    IF v_portion > 0 THEN
      v_scaled := v_scaled + v_portion * v_num;
    END IF;
    v_cursor := v_up_to;
  END LOOP;

  v_fee := v_scaled / v_den;
  IF v_ceil THEN
    v_fee := ceil(v_fee);
  END IF;

  IF v_fee < v_floor THEN
    RETURN v_floor;
  END IF;
  IF v_fee > v_cap THEN
    RETURN v_cap;
  END IF;
  RETURN v_fee;
END;
$$;

COMMENT ON FUNCTION public.calc_yachanga_service_fee(numeric) IS
  'Costo de servicio al contratar: tramo marginal 10% / 6% / 3%, piso 5000, tope 23000. CEIL al peso. No aplica a materiales.';

REVOKE ALL ON FUNCTION public.calc_yachanga_service_fee(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calc_yachanga_service_fee(numeric) FROM anon;
REVOKE ALL ON FUNCTION public.calc_yachanga_service_fee(numeric) FROM service_role;
GRANT EXECUTE ON FUNCTION public.calc_yachanga_service_fee(numeric) TO authenticated;

-- Cuerpo de producción (2026-10-01). Único cambio: v_comision.
CREATE OR REPLACE FUNCTION public.calc_precios_contratacion(p_precio_trabajador numeric)
RETURNS TABLE (precio_final numeric, comision_app numeric)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_neto numeric;
  v_comision numeric;
BEGIN
  IF p_precio_trabajador IS NULL OR p_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;
  v_neto := ceil(p_precio_trabajador);
  v_comision := public.calc_yachanga_service_fee(v_neto);
  RETURN QUERY SELECT v_neto + v_comision, v_comision;
END;
$$;

COMMENT ON FUNCTION public.calc_precios_contratacion(numeric) IS
  'precio_final = neto + calc_yachanga_service_fee(CEIL(neto)). La comisión queda guardada en la fila al cotizar.';

-- Verificación. Si un caso no cierra, la transacción entera falla.
DO $$
DECLARE
  v_fee numeric;
  v_final numeric;
  v_comision numeric;
  v_ok boolean;
  v_case record;
BEGIN
  FOR v_case IN
    SELECT *
    FROM (VALUES
      (0::numeric, 5000::numeric),
      (1, 5000),
      (30000, 5000),
      (49999, 5000),
      (50000, 5000),
      (50001, 5001),
      (120000, 9200),
      (200000, 14000),
      (200001, 14001),
      (350000, 18500),
      (500000, 23000),
      (500001, 23000),
      (750000, 23000)
    ) AS t(amount, expected)
  LOOP
    v_fee := public.calc_yachanga_service_fee(v_case.amount);
    IF v_fee IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION 'calc_yachanga_service_fee(%) = %, esperado %',
        v_case.amount, v_fee, v_case.expected;
    END IF;
  END LOOP;

  SELECT precio_final, comision_app
    INTO v_final, v_comision
  FROM public.calc_precios_contratacion(120000);
  IF v_comision IS DISTINCT FROM 9200 OR v_final IS DISTINCT FROM 129200 THEN
    RAISE EXCEPTION 'calc_precios 120000 → final % comisión %', v_final, v_comision;
  END IF;

  SELECT precio_final, comision_app
    INTO v_final, v_comision
  FROM public.calc_precios_contratacion(350000);
  IF v_comision IS DISTINCT FROM 18500 OR v_final IS DISTINCT FROM 368500 THEN
    RAISE EXCEPTION 'calc_precios 350000 → final % comisión %', v_final, v_comision;
  END IF;

  v_ok := false;
  BEGIN
    PERFORM public.calc_yachanga_service_fee(-1);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'un monto negativo tenía que fallar';
  END IF;

  v_ok := false;
  BEGIN
    PERFORM public.calc_yachanga_service_fee(NULL);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'NULL tenía que fallar';
  END IF;

  v_ok := false;
  BEGIN
    PERFORM public.calc_yachanga_service_fee('NaN'::double precision::numeric);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'NaN tenía que fallar';
  END IF;

  v_ok := false;
  BEGIN
    PERFORM public.calc_precios_contratacion(0);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'precio 0 sigue siendo inválido para cotizar';
  END IF;
END;
$$;
