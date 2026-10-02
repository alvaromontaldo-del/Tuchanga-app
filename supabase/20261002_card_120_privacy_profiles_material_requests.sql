-- Card #120 (Trello): privacidad de apellido, ubicación
-- exacta y dirección del cliente. Proyecto TuChangaAPP.
--
-- PARTE A (compatible con la app vieja): RPC nuevos, redondeo de coordenadas y
-- get_conversation_client_delivery_address con coordenadas redondeadas antes del pago.
-- PARTE B (recién con el OTA del PR de #120 publicado): sacarle a authenticated la
-- lectura directa de profiles.apellido, profiles.location y material_requests.client_address.
-- Las funciones existentes se reconstruyeron desde pg_get_functiondef en vivo.

-- ============================ PARTE A ============================

-- A1. Trigger del pedido de materiales: igual al vivo, salvo que guarda las coordenadas
-- del cliente redondeadas a 2 decimales (~1 km). Nadie las usa para algo exacto: el
-- comercio solo muestra la distancia aproximada y la calle llega con el pago.
CREATE OR REPLACE FUNCTION public.material_requests_apply_client_job_address()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- #120: solo coordenadas redondeadas (2 decimales).
  NEW.client_lat := CASE WHEN v_lat IS NULL THEN NULL ELSE round(v_lat::numeric, 2)::double precision END;
  NEW.client_lng := CASE WHEN v_lng IS NULL THEN NULL ELSE round(v_lng::numeric, 2)::double precision END;
  RETURN NEW;
END;
$function$;

-- Pedidos existentes: redondear sin tocar updated_at ni recalcular el domicilio.
ALTER TABLE public.material_requests DISABLE TRIGGER trg_material_requests_touch;
ALTER TABLE public.material_requests DISABLE TRIGGER trg_material_requests_client_job_address;
UPDATE public.material_requests
SET client_lat = round(client_lat::numeric, 2)::double precision,
    client_lng = round(client_lng::numeric, 2)::double precision
WHERE (client_lat IS NOT NULL AND client_lat::numeric <> round(client_lat::numeric, 2))
   OR (client_lng IS NOT NULL AND client_lng::numeric <> round(client_lng::numeric, 2));
ALTER TABLE public.material_requests ENABLE TRIGGER trg_material_requests_client_job_address;
ALTER TABLE public.material_requests ENABLE TRIGGER trg_material_requests_touch;

-- A2. Domicilio del cliente para el profesional del chat: igual al vivo, salvo que antes
-- del pago (sin calle) las coordenadas van redondeadas.
CREATE OR REPLACE FUNCTION public.get_conversation_client_delivery_address(p_conversation_id uuid)
 RETURNS TABLE(client_id uuid, direccion_texto text, lat double precision, lng double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      WHEN v_show_street THEN ST_Y(p.location::geometry)
      ELSE round(ST_Y(p.location::geometry)::numeric, 2)::double precision
    END,
    CASE
      WHEN p.location IS NULL THEN NULL
      WHEN v_show_street THEN ST_X(p.location::geometry)
      ELSE round(ST_X(p.location::geometry)::numeric, 2)::double precision
    END
  FROM public.profiles p
  WHERE p.id = v_cliente;
END;
$function$;

-- A3. Apellido y coordenadas exactas del propio usuario (perfil, edición, carpeta de Storage).
CREATE OR REPLACE FUNCTION public.get_my_profile_identity()
 RETURNS TABLE(apellido text, lat double precision, lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.apellido,
    CASE WHEN p.location IS NULL THEN NULL ELSE ST_Y(p.location::geometry) END,
    CASE WHEN p.location IS NULL THEN NULL ELSE ST_X(p.location::geometry) END
  FROM public.profiles p
  WHERE p.id = auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.get_my_profile_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_identity() TO authenticated, service_role;

-- A4. Nombre del otro participante. El apellido solo al profesional de ese cliente
-- (o al admin). Regla #117: el cliente nunca recibe el apellido del profesional.
CREATE OR REPLACE FUNCTION public.get_peer_display_name(p_user_id uuid)
 RETURNS TABLE(nombre text, apellido text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_full boolean;
  v_peer boolean;
BEGIN
  IF v_uid IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;

  v_full := v_uid = p_user_id
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.trabajador_id = v_uid AND c.cliente_id = p_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.contrataciones k
      WHERE k.worker_id = v_uid AND k.client_id = p_user_id
    );

  v_peer := v_full
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.cliente_id = v_uid AND c.trabajador_id = p_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.contrataciones k
      WHERE k.client_id = v_uid AND k.worker_id = p_user_id
    );

  IF NOT v_peer THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.nombre, CASE WHEN v_full THEN p.apellido ELSE NULL END
  FROM public.profiles p
  WHERE p.id = p_user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_peer_display_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_peer_display_name(uuid) TO authenticated, service_role;

-- A5. Dirección de entrega para el comercio: solo al dueño del comercio y solo con la
-- orden de ese comercio pagada (costo de servicio aprobado por Mercado Pago).
CREATE OR REPLACE FUNCTION public.get_store_request_client_address(p_request_id uuid, p_store_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_address text;
BEGIN
  IF auth.uid() IS NULL OR p_request_id IS NULL OR p_store_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public.is_store_owner(p_store_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.quotes q
    JOIN public.orders o ON o.quote_id = q.id
    WHERE q.request_id = p_request_id
      AND q.store_id = p_store_id
      AND (o.deposit_status IN ('paid', 'waived') OR o.status IN ('deposit_paid', 'completed'))
  ) THEN
    RETURN NULL;
  END IF;

  SELECT nullif(btrim(mr.client_address), '')
    INTO v_address
  FROM public.material_requests mr
  WHERE mr.id = p_request_id;
  RETURN v_address;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_store_request_client_address(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_request_client_address(uuid, uuid) TO authenticated, service_role;

-- ============================ PARTE B ============================
-- Aplicar recién cuando el OTA del PR de #120 esté publicado (la app vieja lee estas
-- columnas directo y se quedaría sin perfil propio).
--
-- REVOKE SELECT (apellido, location) ON public.profiles FROM authenticated;
-- REVOKE SELECT ON public.material_requests FROM authenticated;
-- GRANT SELECT (id, professional_id, client_id, rubro_id, title, status, created_at,
--               updated_at, client_lat, client_lng, conversation_id)
--   ON public.material_requests TO authenticated;
