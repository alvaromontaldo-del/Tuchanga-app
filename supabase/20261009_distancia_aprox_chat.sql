-- YaChanga — kilómetros aproximados en el chat del profesional.
--
-- NO está aplicado. El 2026-10-09 se corrió este cuerpo en BEGIN …
-- ROLLBACK sobre una conversación real (kyxehrxcdealbujvvnxp):
--   el profesional recibe el km redondeado (pin exacto, no la location
--   lejana; sin pin, cae a profiles.location);
--   400 m → «menos de 1 km»; 3,2 km → «3»; 3,5 km → «3,5»;
--   9,8 y 10 km → «10»; 10,6 km → «11»; 15,2 km → «15»;
--   el cliente, un tercero y una sesión vacía reciben NULL;
--   sin punto usable (location es NOT NULL; 0,0 se descarta) → NULL;
--   si la base del profesional no sirve, usa su pin;
--   una conversación archivada → NULL;
--   anon, PUBLIC y service_role sin EXECUTE; authenticated sí;
--   el retorno es text, sin coordenadas.
-- Después del ROLLBACK la función no quedó y el fingerprint de
-- profiles y conversations no cambió.
--
-- No toca la moderación de mensajes ni obtener_direccion_cliente.
-- La calle y las coordenadas siguen saliendo solo después de pagar el
-- costo de servicio, por las RPC que ya existen.
--
-- Punto del cliente: direccion_lat/lng (#206, card_206_direccion_exacta)
-- y, si no hay pin usable, profiles.location.
-- Punto del profesional: su base de cobertura (profiles.location, la
-- misma de la búsqueda / zona). Si ese punto no es usable, el pin
-- direccion_lat/lng. Si falta cualquiera de los dos, devuelve NULL.

BEGIN;

CREATE OR REPLACE FUNCTION public.distancia_aprox_chat(p_conversation_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  v_client_geog geography;
  v_worker_geog geography;
  v_km numeric;
  v_step numeric;
  v_label text;
BEGIN
  IF auth.uid() IS NULL OR p_conversation_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.cliente_id, c.trabajador_id
    INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.deleted_at IS NULL;

  -- Solo el profesional de esta conversación. El cliente no ve la distancia.
  IF NOT FOUND OR v_cliente IS NULL OR auth.uid() IS DISTINCT FROM v_trabajador THEN
    RETURN NULL;
  END IF;

  SELECT
    CASE
      WHEN p.direccion_lat IS NOT NULL
        AND p.direccion_lng IS NOT NULL
        AND p.direccion_lat BETWEEN -90 AND 90
        AND p.direccion_lng BETWEEN -180 AND 180
        AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0)
        THEN ST_SetSRID(ST_MakePoint(p.direccion_lng, p.direccion_lat), 4326)::geography
      WHEN p.location IS NOT NULL
        AND NOT (
          ST_Y(p.location::geometry) = 0
          AND ST_X(p.location::geometry) = 0
        )
        THEN p.location
      ELSE NULL
    END
  INTO v_client_geog
  FROM public.profiles p
  WHERE p.id = v_cliente;

  SELECT
    CASE
      WHEN p.location IS NOT NULL
        AND NOT (
          ST_Y(p.location::geometry) = 0
          AND ST_X(p.location::geometry) = 0
        )
        THEN p.location
      WHEN p.direccion_lat IS NOT NULL
        AND p.direccion_lng IS NOT NULL
        AND p.direccion_lat BETWEEN -90 AND 90
        AND p.direccion_lng BETWEEN -180 AND 180
        AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0)
        THEN ST_SetSRID(ST_MakePoint(p.direccion_lng, p.direccion_lat), 4326)::geography
      ELSE NULL
    END
  INTO v_worker_geog
  FROM public.profiles p
  WHERE p.id = v_trabajador;

  IF v_client_geog IS NULL OR v_worker_geog IS NULL THEN
    RETURN NULL;
  END IF;

  v_km := (ST_Distance(v_worker_geog, v_client_geog) / 1000.0)::numeric;
  IF v_km IS NULL OR v_km < 0 THEN
    RETURN NULL;
  END IF;

  IF v_km < 1 THEN
    RETURN 'menos de 1 km';
  ELSIF v_km <= 10 THEN
    v_step := round(v_km * 2) / 2;
  ELSE
    v_step := round(v_km, 0);
  END IF;

  IF v_step = trunc(v_step) THEN
    v_label := btrim(to_char(v_step, 'FM999999990'));
  ELSE
    v_label := replace(btrim(to_char(v_step, 'FM999999990.0')), '.', ',');
  END IF;

  -- Solo el token de kilómetros. Nunca coordenadas.
  IF v_label IS NULL OR v_label !~ '^[0-9]+(,[0-9])?$' THEN
    RETURN NULL;
  END IF;

  RETURN v_label;
END;
$function$;

COMMENT ON FUNCTION public.distancia_aprox_chat(uuid) IS
  'Km aproximados entre la base del profesional y el cliente de la conversación. Solo el profesional. No devuelve coordenadas ni dirección. Menos de 1 km: «menos de 1 km»; hasta 10 km de a 0,5; más de 10 de a 1. NULL si falta una ubicación.';

REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.distancia_aprox_chat(uuid) TO authenticated;

COMMIT;
