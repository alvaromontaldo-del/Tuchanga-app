-- YaChanga — pedido de materiales: la entrega es SIEMPRE el domicilio del cliente
-- del chat (conversations.cliente_id → profiles), nunca el del profesional.
--
-- NO está aplicado. Ejecutar este archivo una sola vez en el SQL editor de Supabase.
-- La app deja de pedir la dirección en el formulario. Hasta que este SQL corra,
-- el texto de la calle no se puede leer (direccion_texto es PII revocada) y el
-- insert solo puede guardar las coordenadas públicas de profiles.location.
-- Después de ejecutarlo, el trigger pisa client_address / client_lat / client_lng
-- en cada alta, aunque el cliente mande otro valor.
--
-- Privacidad (igual que get_job_client_location): la calle (direccion_texto) solo
-- se devuelve / copia si el profesional del chat tiene una contratación con ese
-- cliente con seña o total pagado. Si no, solo viajan las coordenadas públicas
-- (profiles.location). El trigger rechaza un pedido cuyo profesional no es el
-- trabajador de ese chat (evita leer el domicilio de otro cliente).
--
-- No toca flete, fee de materiales, PIN, push ni cotizaciones multi-comercio.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_conversation_client_delivery_address(p_conversation_id uuid)
RETURNS TABLE (
  client_id uuid,
  direccion_texto text,
  lat double precision,
  lng double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  v_show_street boolean;
BEGIN
  IF auth.uid() IS NULL OR p_conversation_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.cliente_id, c.trabajador_id
    INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND OR v_cliente IS NULL THEN
    RETURN;
  END IF;

  -- Solo un participante del chat. El domicilio que se devuelve es el del cliente.
  IF auth.uid() IS DISTINCT FROM v_cliente AND auth.uid() IS DISTINCT FROM v_trabajador THEN
    RETURN;
  END IF;

  -- La calle: al propio cliente, o al profesional con un trabajo pagado (seña o total).
  v_show_street := auth.uid() = v_cliente OR EXISTS (
    SELECT 1
    FROM public.contrataciones k
    WHERE k.worker_id = v_trabajador
      AND k.client_id = v_cliente
      AND k.estado_pago IN ('seña_pagada', 'totalmente_pagado')
  );

  RETURN QUERY
  SELECT
    p.id,
    CASE WHEN v_show_street THEN nullif(btrim(p.direccion_texto), '') ELSE NULL END,
    CASE
      WHEN p.location IS NULL THEN NULL
      ELSE ST_Y(p.location::geometry)
    END,
    CASE
      WHEN p.location IS NULL THEN NULL
      ELSE ST_X(p.location::geometry)
    END
  FROM public.profiles p
  WHERE p.id = v_cliente;
END;
$$;

COMMENT ON FUNCTION public.get_conversation_client_delivery_address(uuid) IS
  'Domicilio del cliente del chat (profiles de conversations.cliente_id). Solo si auth.uid() es cliente o trabajador de esa conversación. No lee el perfil del profesional.';

REVOKE ALL ON FUNCTION public.get_conversation_client_delivery_address(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversation_client_delivery_address(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_conversation_client_delivery_address(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_client_delivery_address(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.material_requests_apply_client_job_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  v_show_street boolean;
  v_address text;
  v_lat double precision;
  v_lng double precision;
BEGIN
  -- Sin chat no hay domicilio de obra: no conservar una dirección tipeada.
  IF NEW.conversation_id IS NULL THEN
    NEW.client_address := NULL;
    NEW.client_lat := NULL;
    NEW.client_lng := NULL;
    RETURN NEW;
  END IF;

  SELECT c.cliente_id, c.trabajador_id
    INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id
    AND c.deleted_at IS NULL;

  IF v_cliente IS NULL THEN
    NEW.client_address := NULL;
    NEW.client_lat := NULL;
    NEW.client_lng := NULL;
    RETURN NEW;
  END IF;

  -- El pedido tiene que ser del trabajador de ese chat; si no, alguien podría
  -- leer el domicilio de un cliente ajeno poniendo otro conversation_id.
  IF NEW.professional_id IS NOT NULL AND NEW.professional_id IS DISTINCT FROM v_trabajador THEN
    RAISE EXCEPTION 'material_request_not_conversation_worker' USING ERRCODE = '42501';
  END IF;

  NEW.client_id := v_cliente;

  v_show_street := NEW.professional_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.contrataciones k
    WHERE k.worker_id = v_trabajador
      AND k.client_id = v_cliente
      AND k.estado_pago IN ('seña_pagada', 'totalmente_pagado')
  );

  SELECT
    nullif(btrim(p.direccion_texto), ''),
    CASE
      WHEN p.location IS NULL THEN NULL
      ELSE ST_Y(p.location::geometry)
    END,
    CASE
      WHEN p.location IS NULL THEN NULL
      ELSE ST_X(p.location::geometry)
    END
    INTO v_address, v_lat, v_lng
  FROM public.profiles p
  WHERE p.id = v_cliente;

  IF v_lat IS NULL
     OR v_lng IS NULL
     OR v_lat < -90 OR v_lat > 90
     OR v_lng < -180 OR v_lng > 180
     OR (v_lat = 0 AND v_lng = 0) THEN
    v_lat := NULL;
    v_lng := NULL;
  END IF;

  NEW.client_address := CASE WHEN v_show_street THEN v_address ELSE NULL END;
  NEW.client_lat := v_lat;
  NEW.client_lng := v_lng;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.material_requests_apply_client_job_address() IS
  'Al crear o editar un pedido de materiales, copia el domicilio del cliente del chat. Ignora la dirección enviada por la app.';

REVOKE ALL ON FUNCTION public.material_requests_apply_client_job_address() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.material_requests_apply_client_job_address() FROM anon;
GRANT EXECUTE ON FUNCTION public.material_requests_apply_client_job_address() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_material_requests_client_job_address ON public.material_requests;
CREATE TRIGGER trg_material_requests_client_job_address
BEFORE INSERT OR UPDATE OF conversation_id, professional_id, client_id, client_address, client_lat, client_lng
ON public.material_requests
FOR EACH ROW
EXECUTE FUNCTION public.material_requests_apply_client_job_address();

COMMENT ON COLUMN public.material_requests.client_address IS
  'Dirección de entrega: domicilio del cliente del chat (profiles.direccion_texto de conversations.cliente_id). La app no la edita.';

COMMIT;
