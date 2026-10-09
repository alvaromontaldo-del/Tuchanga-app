-- YaChanga #206 — ubicación exacta del cliente.
--
-- NO está aplicado. El 2026-10-09 se corrió este cuerpo en BEGIN …
-- ROLLBACK sobre un perfil real de Parque Sarmiento: lat -33.30376,
-- lng -60.24138, direccion_completa con partido, direccion_texto corto,
-- authenticated sin SELECT de las columnas nuevas, anon sin EXECUTE.
-- Después del ROLLBACK la base quedó como estaba (solo direccion_texto;
-- obtener_direccion_cliente sin la columna extra).
-- No corre el backfill de direcciones viejas.
--
-- Cuerpo de obtener_direccion_cliente reconstruido con
-- pg_get_functiondef('public.obtener_direccion_cliente(uuid)') el 2026-10-09
-- (kyxehrxcdealbujvvnxp). Misma firma de entrada (uuid). El RETURNS suma
-- direccion_completa: PostgREST no puede CREATE OR REPLACE con otro OUT,
-- por eso hay DROP y se vuelven a dar los mismos grants
-- (authenticated y service_role; anon no tiene EXECUTE).
-- Guards intactos: solo el trabajador, con seña o total pago, y agenda confirmada.
--
-- profiles.direccion_lat / direccion_lng / direccion_completa son PII.
-- No se otorgan a authenticated ni a anon. Las escribe set_my_direccion_exacta
-- (solo auth.uid()) y las lee obtener_direccion_cliente después del pago.
-- La ficha sigue mostrando direccion_texto (calle corta).

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS direccion_lat double precision,
  ADD COLUMN IF NOT EXISTS direccion_lng double precision,
  ADD COLUMN IF NOT EXISTS direccion_completa text;

COMMENT ON COLUMN public.profiles.direccion_lat IS
  'Latitud del domicilio elegido en la búsqueda. PII: no la lee authenticated.';
COMMENT ON COLUMN public.profiles.direccion_lng IS
  'Longitud del domicilio elegido en la búsqueda. PII: no la lee authenticated.';
COMMENT ON COLUMN public.profiles.direccion_completa IS
  'Calle, localidad, partido y provincia. PII. La ficha muestra direccion_texto.';

REVOKE ALL (direccion_lat, direccion_lng, direccion_completa)
  ON TABLE public.profiles FROM PUBLIC;
REVOKE ALL (direccion_lat, direccion_lng, direccion_completa)
  ON TABLE public.profiles FROM anon;
REVOKE ALL (direccion_lat, direccion_lng, direccion_completa)
  ON TABLE public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_my_direccion_exacta(
  p_lat double precision,
  p_lng double precision,
  p_direccion_completa text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_lat double precision := p_lat;
  v_lng double precision := p_lng;
  v_completa text := nullif(btrim(coalesce(p_direccion_completa, '')), '');
  v_has_point boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_has_point := v_lat IS NOT NULL
    AND v_lng IS NOT NULL
    AND v_lat BETWEEN -90 AND 90
    AND v_lng BETWEEN -180 AND 180
    AND NOT (v_lat = 0 AND v_lng = 0);

  IF NOT v_has_point THEN
    v_lat := NULL;
    v_lng := NULL;
  END IF;

  IF v_lat IS NULL AND v_completa IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET
    direccion_lat = COALESCE(v_lat, direccion_lat),
    direccion_lng = COALESCE(v_lng, direccion_lng),
    direccion_completa = COALESCE(v_completa, direccion_completa),
    location = CASE
      WHEN v_lat IS NOT NULL THEN ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
      ELSE location
    END,
    updated_at = now()
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.set_my_direccion_exacta(double precision, double precision, text) IS
  'Guarda lat/lng y dirección completa del auth.uid(). No toca direccion_texto. Un argumento vacío no pisa el valor anterior.';

REVOKE ALL ON FUNCTION public.set_my_direccion_exacta(double precision, double precision, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_direccion_exacta(double precision, double precision, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_direccion_exacta(double precision, double precision, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.obtener_direccion_cliente(uuid);

CREATE FUNCTION public.obtener_direccion_cliente(p_contratacion_id uuid)
 RETURNS TABLE(
   direccion_texto text,
   detalles_ubicacion text,
   lat double precision,
   lng double precision,
   direccion_completa text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF v_row.fecha_trabajo IS NULL OR v_row.estado_trabajo NOT IN (
    'aceptado', 'en_curso', 'pendiente_pago_diferencia', 'finalizado', 'disputa'
  ) THEN
    RAISE EXCEPTION 'Agenda no confirmada';
  END IF;

  RETURN QUERY
  SELECT
    p.direccion_texto,
    NULLIF(trim(p.detalles_ubicacion), ''),
    CASE
      WHEN p.direccion_lat IS NOT NULL
        AND p.direccion_lng IS NOT NULL
        AND p.direccion_lat BETWEEN -90 AND 90
        AND p.direccion_lng BETWEEN -180 AND 180
        AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0)
        THEN p.direccion_lat
      WHEN p.location IS NULL THEN NULL
      ELSE ST_Y(p.location::geometry)::double precision
    END,
    CASE
      WHEN p.direccion_lat IS NOT NULL
        AND p.direccion_lng IS NOT NULL
        AND p.direccion_lat BETWEEN -90 AND 90
        AND p.direccion_lng BETWEEN -180 AND 180
        AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0)
        THEN p.direccion_lng
      WHEN p.location IS NULL THEN NULL
      ELSE ST_X(p.location::geometry)::double precision
    END,
    NULLIF(btrim(p.direccion_completa), '')
  FROM public.profiles p
  WHERE p.id = v_row.client_id;
END;
$function$;

COMMENT ON FUNCTION public.obtener_direccion_cliente(uuid) IS
  'Domicilio del cliente. Solo el trabajador de la contratación, con seña o total pago y agenda confirmada. lat/lng prefieren direccion_lat/lng y si no, profiles.location.';

REVOKE ALL ON FUNCTION public.obtener_direccion_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obtener_direccion_cliente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.obtener_direccion_cliente(uuid) TO authenticated, service_role;

COMMIT;
