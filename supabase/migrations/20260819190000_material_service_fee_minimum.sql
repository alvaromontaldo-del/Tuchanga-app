-- Mínimo $5.000 en costo de servicio YaChanga (materiales).

CREATE OR REPLACE FUNCTION public.calculate_material_service_fee(p_total numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total numeric := coalesce(p_total, 0);
  v_raw numeric;
  v_cap constant numeric := 23000;
  v_min constant numeric := 5000;
  v_lim1 constant numeric := 200000;
  v_break constant numeric := 316667;
  v_ceiled numeric;
BEGIN
  IF v_total <= 0 THEN
    RETURN 0;
  END IF;

  IF v_total <= v_lim1 THEN
    v_raw := v_total * 0.08;
  ELSIF v_total <= v_break THEN
    v_raw := 16000 + (v_total - v_lim1) * 0.06;
  ELSE
    RETURN v_cap;
  END IF;

  v_ceiled := ceil(v_raw);
  RETURN least(greatest(v_ceiled, v_min), v_cap);
END;
$$;

COMMENT ON FUNCTION public.calculate_material_service_fee(numeric) IS
  'Costo de Servicio materiales: ≤200k 8%; hasta 316667 $16k+6% excedente; mín $5000; tope $23000. Siempre CEIL.';
