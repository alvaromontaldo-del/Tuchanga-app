-- Actualizar ubicación base (punto) y radio de cobertura del perfil autenticado.
-- Ejecutar en Supabase SQL Editor si ya aplicaste 001.

CREATE OR REPLACE FUNCTION public.update_profile_geo_coverage (
  p_direccion TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_coverage_km INTEGER
) RETURNS VOID AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    direccion_texto = trim(p_direccion),
    location = ST_SetSRID (ST_MakePoint (p_lng, p_lat), 4326)::geography,
    coverage_km = p_coverage_km,
    updated_at = now()
  WHERE
    id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;

$$ LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public;

GRANT EXECUTE ON FUNCTION public.update_profile_geo_coverage (TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;
