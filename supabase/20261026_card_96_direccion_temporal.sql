-- #96 Dirección temporal de un trabajo.
-- NO APLICAR desde la app. Un solo archivo, una transacción.
-- El profesional ya puede leer `conversations` (policy conv_select_participant)
-- y la tabla está en supabase_realtime. Por eso el texto y las coordenadas
-- NO van en conversations: viven en conversation_job_address, con RLS
-- solo para el cliente. En conversations queda únicamente
-- job_address_updated_at, un tick para que el profesional vuelva a pedir
-- distancia_aprox_chat. No es una dirección ni una coordenada.
--
-- Antes del pago el profesional no ve el texto ni el punto exacto.
-- distancia_aprox_chat sigue devolviendo solo el token de km, redondeado
-- igual que hoy, pero el punto del cliente sale de la dirección temporal
-- si hay una válida.
-- Después del pago de UN trabajo de ESTA conversación,
-- get_conversation_client_delivery_address y obtener_direccion_cliente
-- devuelven esa dirección (temporal o perfil), completa y exacta.
-- Antes del pago el profesional no recibe fila: ni calle ni coordenadas,
-- tampoco redondeadas. El cliente sigue viendo la suya.
-- El comercio destinatario sigue viendo la calle para el flete
-- (get_store_request_client_address), sin coordenadas y sin PIN.
-- El texto no pasa por el antipuenteo: antes del pago el otro no lo ve,
-- y después del pago es el domicilio del trabajo, igual que direccion_texto.
--
-- Funciones reconstruidas desde pg_get_functiondef el 2026-10-26.
-- md5 previo (la guarda aborta si el cuerpo vivo ya no coincide):
--   distancia_aprox_chat(uuid)                              86fa0f176593602bfd4315d6a7a97dc2
--   get_conversation_client_delivery_address(uuid)          e97eb5d8c39119b8af0e72625b2296b4
--   material_requests_apply_client_job_address()            87587b575c0d60d2dfe9b6d9d311a623
--   obtener_direccion_cliente(uuid)                         b63b3abb85892a049d9ce7df0133fcb6
--   get_store_request_client_address(uuid, uuid)           dd6fe793763ea5fd5bfaf8f276e681ca
-- No se recrean set_my_direccion_exacta ni update_profile_geo_coverage:
-- set_conversation_job_address las llama si el cliente pide guardar
-- también el perfil. anon no recibe EXECUTE de nada nuevo.

BEGIN;

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.distancia_aprox_chat(uuid)'::regprocedure))
     IS DISTINCT FROM '86fa0f176593602bfd4315d6a7a97dc2' THEN
    RAISE EXCEPTION 'distancia_aprox_chat cambió desde el md5 vivo';
  END IF;
  IF md5(pg_get_functiondef('public.get_conversation_client_delivery_address(uuid)'::regprocedure))
     IS DISTINCT FROM 'e97eb5d8c39119b8af0e72625b2296b4' THEN
    RAISE EXCEPTION 'get_conversation_client_delivery_address cambió desde el md5 vivo';
  END IF;
  IF md5(pg_get_functiondef('public.material_requests_apply_client_job_address()'::regprocedure))
     IS DISTINCT FROM '87587b575c0d60d2dfe9b6d9d311a623' THEN
    RAISE EXCEPTION 'material_requests_apply_client_job_address cambió desde el md5 vivo';
  END IF;
  IF md5(pg_get_functiondef('public.obtener_direccion_cliente(uuid)'::regprocedure))
     IS DISTINCT FROM 'b63b3abb85892a049d9ce7df0133fcb6' THEN
    RAISE EXCEPTION 'obtener_direccion_cliente cambió desde el md5 vivo';
  END IF;
  IF md5(pg_get_functiondef('public.get_store_request_client_address(uuid, uuid)'::regprocedure))
     IS DISTINCT FROM 'dd6fe793763ea5fd5bfaf8f276e681ca' THEN
    RAISE EXCEPTION 'get_store_request_client_address cambió desde el md5 vivo';
  END IF;
END
$guard$;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS job_address_updated_at timestamptz;

COMMENT ON COLUMN public.conversations.job_address_updated_at IS
  'Tick para refrescar distancia_aprox_chat. No guarda dirección ni coordenadas.';

CREATE TABLE public.conversation_job_address (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations (id) ON DELETE CASCADE,
  job_address_text text,
  job_lat double precision,
  job_lng double precision,
  job_address_confirmed_at timestamptz,
  job_address_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_job_address_coords CHECK (
    (job_lat IS NULL AND job_lng IS NULL)
    OR (
      job_lat BETWEEN -90 AND 90
      AND job_lng BETWEEN -180 AND 180
      AND NOT (job_lat = 0 AND job_lng = 0)
      AND nullif(btrim(job_address_text), '') IS NOT NULL
      AND char_length(job_address_text) <= 300
    )
  )
);

COMMENT ON TABLE public.conversation_job_address IS
  'Dirección de un trabajo. NULL en lat/lng = se usa el perfil. Solo la lee el cliente.';

ALTER TABLE public.conversation_job_address ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_job_address FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.conversation_job_address FROM PUBLIC;
REVOKE ALL ON TABLE public.conversation_job_address FROM anon;
REVOKE ALL ON TABLE public.conversation_job_address FROM authenticated;
REVOKE ALL ON TABLE public.conversation_job_address FROM service_role;
GRANT SELECT ON TABLE public.conversation_job_address TO authenticated;

CREATE POLICY conversation_job_address_select_client
  ON public.conversation_job_address
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_job_address.conversation_id
        AND c.cliente_id = auth.uid()
        AND c.deleted_at IS NULL
    )
  );

-- Sin INSERT/UPDATE/DELETE: solo escriben las RPC SECURITY DEFINER.
-- No se publica en supabase_realtime.

CREATE OR REPLACE FUNCTION public.set_conversation_job_address(
  p_conversation_id uuid,
  p_texto text,
  p_lat double precision,
  p_lng double precision,
  p_also_profile boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cliente uuid;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_coverage integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'not_conversation_client' USING ERRCODE = '42501';
  END IF;

  SELECT c.cliente_id
    INTO v_cliente
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND OR v_cliente IS NULL OR v_uid IS DISTINCT FROM v_cliente THEN
    RAISE EXCEPTION 'not_conversation_client' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contrataciones k
    WHERE k.conversation_id = p_conversation_id
      AND k.estado_pago IN ('seña_pagada', 'totalmente_pagado')
  ) THEN
    RAISE EXCEPTION 'job_address_locked_after_payment' USING ERRCODE = '42501';
  END IF;

  IF v_texto IS NULL
     OR char_length(v_texto) > 300
     OR p_lat IS NULL
     OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90
     OR p_lng < -180 OR p_lng > 180
     OR (p_lat = 0 AND p_lng = 0) THEN
    RAISE EXCEPTION 'invalid_job_address' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.conversation_job_address (
    conversation_id,
    job_address_text,
    job_lat,
    job_lng,
    job_address_confirmed_at,
    job_address_updated_at
  ) VALUES (
    p_conversation_id,
    v_texto,
    p_lat,
    p_lng,
    NULL,
    now()
  )
  ON CONFLICT (conversation_id) DO UPDATE
  SET job_address_text = EXCLUDED.job_address_text,
      job_lat = EXCLUDED.job_lat,
      job_lng = EXCLUDED.job_lng,
      job_address_confirmed_at = NULL,
      job_address_updated_at = now();

  UPDATE public.conversations
  SET job_address_updated_at = now()
  WHERE id = p_conversation_id;

  IF COALESCE(p_also_profile, false) THEN
    SELECT p.coverage_km
      INTO v_coverage
    FROM public.profiles p
    WHERE p.id = v_uid;
    PERFORM public.update_profile_geo_coverage(v_texto, p_lat, p_lng, v_coverage);
    PERFORM public.set_my_direccion_exacta(p_lat, p_lng, v_texto);
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.set_conversation_job_address(uuid, text, double precision, double precision, boolean) IS
  'El cliente guarda la dirección de este trabajo. Si p_also_profile, reutiliza el guardado del perfil.';

REVOKE ALL ON FUNCTION public.set_conversation_job_address(uuid, text, double precision, double precision, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_conversation_job_address(uuid, text, double precision, double precision, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.set_conversation_job_address(uuid, text, double precision, double precision, boolean) FROM service_role;
GRANT EXECUTE ON FUNCTION public.set_conversation_job_address(uuid, text, double precision, double precision, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_conversation_job_address(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cliente uuid;
BEGIN
  IF v_uid IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'not_conversation_client' USING ERRCODE = '42501';
  END IF;

  SELECT c.cliente_id
    INTO v_cliente
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND OR v_cliente IS NULL OR v_uid IS DISTINCT FROM v_cliente THEN
    RAISE EXCEPTION 'not_conversation_client' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contrataciones k
    WHERE k.conversation_id = p_conversation_id
      AND k.estado_pago IN ('seña_pagada', 'totalmente_pagado')
  ) THEN
    RAISE EXCEPTION 'job_address_locked_after_payment' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_job_address (
    conversation_id,
    job_address_confirmed_at,
    job_address_updated_at
  ) VALUES (
    p_conversation_id,
    now(),
    now()
  )
  ON CONFLICT (conversation_id) DO UPDATE
  SET job_address_confirmed_at = now(),
      job_address_updated_at = now();

  UPDATE public.conversations
  SET job_address_updated_at = now()
  WHERE id = p_conversation_id;
END;
$function$;

COMMENT ON FUNCTION public.confirm_conversation_job_address(uuid) IS
  'El cliente acepta la dirección con la que se cotiza este trabajo. No copia coordenadas al profesional.';

REVOKE ALL ON FUNCTION public.confirm_conversation_job_address(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_conversation_job_address(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_conversation_job_address(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.confirm_conversation_job_address(uuid) TO authenticated;

-- distancia_aprox_chat: único cambio, la fuente de v_client_geog.
-- Redondeo, «solo el profesional» y el regex final quedan igual.
CREATE OR REPLACE FUNCTION public.distancia_aprox_chat(p_conversation_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  IF auth.uid() IS NULL OR p_conversation_id IS NULL THEN RETURN NULL; END IF;
  SELECT c.cliente_id, c.trabajador_id INTO v_cliente, v_trabajador
  FROM public.conversations c
  WHERE c.id = p_conversation_id AND c.deleted_at IS NULL;
  -- Solo el profesional de esta conversación. El cliente no ve la distancia.
  IF NOT FOUND OR v_cliente IS NULL OR auth.uid() IS DISTINCT FROM v_trabajador THEN RETURN NULL; END IF;
  SELECT COALESCE(
    (
      SELECT ST_SetSRID(ST_MakePoint(j.job_lng, j.job_lat), 4326)::geography
      FROM public.conversation_job_address j
      WHERE j.conversation_id = p_conversation_id
        AND j.job_lat IS NOT NULL
        AND j.job_lng IS NOT NULL
        AND j.job_lat BETWEEN -90 AND 90
        AND j.job_lng BETWEEN -180 AND 180
        AND NOT (j.job_lat = 0 AND j.job_lng = 0)
    ),
    (
      SELECT CASE
        WHEN p.direccion_lat IS NOT NULL AND p.direccion_lng IS NOT NULL
          AND p.direccion_lat BETWEEN -90 AND 90 AND p.direccion_lng BETWEEN -180 AND 180
          AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0)
          THEN ST_SetSRID(ST_MakePoint(p.direccion_lng, p.direccion_lat), 4326)::geography
        WHEN p.location IS NOT NULL AND NOT (ST_Y(p.location::geometry) = 0 AND ST_X(p.location::geometry) = 0)
          THEN p.location
        ELSE NULL
      END
      FROM public.profiles p
      WHERE p.id = v_cliente
    )
  ) INTO v_client_geog;
  SELECT CASE
    WHEN p.location IS NOT NULL AND NOT (ST_Y(p.location::geometry) = 0 AND ST_X(p.location::geometry) = 0)
      THEN p.location
    WHEN p.direccion_lat IS NOT NULL AND p.direccion_lng IS NOT NULL
      AND p.direccion_lat BETWEEN -90 AND 90 AND p.direccion_lng BETWEEN -180 AND 180
      AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0)
      THEN ST_SetSRID(ST_MakePoint(p.direccion_lng, p.direccion_lat), 4326)::geography
    ELSE NULL
  END INTO v_worker_geog
  FROM public.profiles p
  WHERE p.id = v_trabajador;
  IF v_client_geog IS NULL OR v_worker_geog IS NULL THEN RETURN NULL; END IF;
  v_km := (ST_Distance(v_worker_geog, v_client_geog) / 1000.0)::numeric;
  IF v_km IS NULL OR v_km < 0 THEN RETURN NULL; END IF;
  IF v_km < 1 THEN RETURN 'menos de 1 km'; ELSIF v_km <= 10 THEN v_step := round(v_km * 2) / 2; ELSE v_step := round(v_km, 0); END IF;
  IF v_step = trunc(v_step) THEN v_label := btrim(to_char(v_step, 'FM999999990')); ELSE v_label := replace(btrim(to_char(v_step, 'FM999999990.0')), '.', ','); END IF;
  -- Solo el token de kilómetros. Nunca coordenadas.
  IF v_label IS NULL OR v_label !~ '^[0-9]+(,[0-9])?$' THEN RETURN NULL; END IF;
  RETURN v_label;
END;
$function$;

COMMENT ON FUNCTION public.distancia_aprox_chat(uuid) IS
  'Km redondeados al profesional. Usa la dirección temporal del trabajo si existe; si no, el perfil.';

REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.distancia_aprox_chat(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.distancia_aprox_chat(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_conversation_client_delivery_address(p_conversation_id uuid)
 RETURNS TABLE(client_id uuid, direccion_texto text, lat double precision, lng double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  v_paid_here boolean;
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

  -- Pago de ESTA conversación. Un trabajo viejo del mismo par no alcanza.
  v_paid_here := EXISTS (
    SELECT 1
    FROM public.contrataciones k
    WHERE k.conversation_id = p_conversation_id
      AND k.estado_pago IN ('seña_pagada', 'totalmente_pagado')
  );

  -- Antes del pago el profesional no recibe nada: ni calle ni coordenadas.
  IF auth.uid() IS DISTINCT FROM v_cliente AND NOT v_paid_here THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_cliente,
    nullif(btrim(j.job_address_text), ''),
    j.job_lat,
    j.job_lng
  FROM public.conversation_job_address j
  WHERE j.conversation_id = p_conversation_id
    AND j.job_lat IS NOT NULL
    AND j.job_lng IS NOT NULL
    AND j.job_lat BETWEEN -90 AND 90
    AND j.job_lng BETWEEN -180 AND 180
    AND NOT (j.job_lat = 0 AND j.job_lng = 0);

  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    nullif(btrim(p.direccion_texto), ''),
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
$function$;

COMMENT ON FUNCTION public.get_conversation_client_delivery_address(uuid) IS
  'Dirección temporal o del perfil. El cliente la ve siempre. El profesional, solo si esta conversación tiene un trabajo pago, y entonces exacta.';

REVOKE ALL ON FUNCTION public.get_conversation_client_delivery_address(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversation_client_delivery_address(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_conversation_client_delivery_address(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_client_delivery_address(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.obtener_direccion_cliente(p_contratacion_id uuid)
 RETURNS TABLE(direccion_texto text, detalles_ubicacion text, lat double precision, lng double precision, direccion_completa text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);
  IF v_row.worker_id <> auth.uid() THEN RAISE EXCEPTION 'Solo el trabajador puede ver la dirección'; END IF;
  IF v_row.estado_pago NOT IN ('seña_pagada', 'totalmente_pagado') THEN RAISE EXCEPTION 'Dirección no disponible hasta pagar la seña'; END IF;
  IF v_row.fecha_trabajo IS NULL OR v_row.estado_trabajo NOT IN ('aceptado', 'en_curso', 'pendiente_pago_diferencia', 'finalizado', 'disputa') THEN RAISE EXCEPTION 'Agenda no confirmada'; END IF;

  IF v_row.conversation_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      j.job_address_text,
      NULL::text,
      j.job_lat,
      j.job_lng,
      NULLIF(btrim(j.job_address_text), '')
    FROM public.conversation_job_address j
    WHERE j.conversation_id = v_row.conversation_id
      AND j.job_lat IS NOT NULL
      AND j.job_lng IS NOT NULL
      AND j.job_lat BETWEEN -90 AND 90
      AND j.job_lng BETWEEN -180 AND 180
      AND NOT (j.job_lat = 0 AND j.job_lng = 0)
      AND nullif(btrim(j.job_address_text), '') IS NOT NULL;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT p.direccion_texto, NULLIF(trim(p.detalles_ubicacion), ''),
    CASE WHEN p.direccion_lat IS NOT NULL AND p.direccion_lng IS NOT NULL AND p.direccion_lat BETWEEN -90 AND 90 AND p.direccion_lng BETWEEN -180 AND 180 AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0) THEN p.direccion_lat WHEN p.location IS NULL THEN NULL ELSE ST_Y(p.location::geometry)::double precision END,
    CASE WHEN p.direccion_lat IS NOT NULL AND p.direccion_lng IS NOT NULL AND p.direccion_lat BETWEEN -90 AND 90 AND p.direccion_lng BETWEEN -180 AND 180 AND NOT (p.direccion_lat = 0 AND p.direccion_lng = 0) THEN p.direccion_lng WHEN p.location IS NULL THEN NULL ELSE ST_X(p.location::geometry)::double precision END,
    NULLIF(btrim(p.direccion_completa), '')
  FROM public.profiles p WHERE p.id = v_row.client_id;
END;
$function$;

COMMENT ON FUNCTION public.obtener_direccion_cliente(uuid) IS
  'Después del pago, la dirección temporal del trabajo si existe; si no, la del perfil.';

REVOKE ALL ON FUNCTION public.obtener_direccion_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obtener_direccion_cliente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.obtener_direccion_cliente(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.material_requests_apply_client_job_address()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente uuid;
  v_trabajador uuid;
  v_paid_here boolean;
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

  v_paid_here := EXISTS (
    SELECT 1
    FROM public.contrataciones k
    WHERE k.conversation_id = NEW.conversation_id
      AND k.estado_pago IN ('seña_pagada', 'totalmente_pagado')
  );

  SELECT
    nullif(btrim(j.job_address_text), ''),
    j.job_lat,
    j.job_lng
    INTO v_address, v_lat, v_lng
  FROM public.conversation_job_address j
  WHERE j.conversation_id = NEW.conversation_id
    AND j.job_lat IS NOT NULL
    AND j.job_lng IS NOT NULL
    AND j.job_lat BETWEEN -90 AND 90
    AND j.job_lng BETWEEN -180 AND 180
    AND NOT (j.job_lat = 0 AND j.job_lng = 0);

  IF NOT FOUND THEN
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
  END IF;

  IF v_lat IS NULL
     OR v_lng IS NULL
     OR v_lat < -90 OR v_lat > 90
     OR v_lng < -180 OR v_lng > 180
     OR (v_lat = 0 AND v_lng = 0) THEN
    v_lat := NULL;
    v_lng := NULL;
  END IF;

  -- La calle queda para el comercio (no tiene SELECT sobre la columna).
  -- Las coordenadas solo si esta conversación ya está paga, y exactas.
  -- Antes del pago el profesional no las puede leer.
  NEW.client_address := v_address;
  NEW.client_lat := CASE WHEN v_paid_here THEN v_lat ELSE NULL END;
  NEW.client_lng := CASE WHEN v_paid_here THEN v_lng ELSE NULL END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.material_requests_apply_client_job_address() IS
  'Copia la dirección del trabajo (temporal o perfil). Coordenadas exactas solo si esta conversación está paga.';

REVOKE ALL ON FUNCTION public.material_requests_apply_client_job_address() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.material_requests_apply_client_job_address() FROM anon;
REVOKE ALL ON FUNCTION public.material_requests_apply_client_job_address() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.material_requests_apply_client_job_address() TO service_role;

-- Calle para el comercio que cotiza el flete. No devuelve coordenadas ni el PIN.
-- Si hay dirección temporal de esa conversación, esa es la de entrega.
CREATE OR REPLACE FUNCTION public.get_store_request_client_address(p_request_id uuid, p_store_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_address text;
  v_client uuid;
  v_professional uuid;
  v_conversation uuid;
  v_job text;
BEGIN
  IF auth.uid() IS NULL OR p_request_id IS NULL OR p_store_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public.is_store_owner(p_store_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.request_target_stores rts
    WHERE rts.request_id = p_request_id
      AND rts.store_id = p_store_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT
    nullif(btrim(mr.client_address), ''),
    mr.client_id,
    mr.professional_id,
    mr.conversation_id
    INTO v_address, v_client, v_professional, v_conversation
  FROM public.material_requests mr
  WHERE mr.id = p_request_id;

  IF v_conversation IS NOT NULL THEN
    SELECT nullif(btrim(j.job_address_text), '')
      INTO v_job
    FROM public.conversation_job_address j
    WHERE j.conversation_id = v_conversation
      AND nullif(btrim(j.job_address_text), '') IS NOT NULL;
    IF v_job IS NOT NULL THEN
      RETURN v_job;
    END IF;
  END IF;

  IF v_address IS NULL AND v_conversation IS NOT NULL THEN
    SELECT nullif(btrim(p.direccion_texto), '')
      INTO v_address
    FROM public.conversations c
    JOIN public.profiles p ON p.id = c.cliente_id
    WHERE c.id = v_conversation
      AND c.deleted_at IS NULL
      AND c.cliente_id IS NOT NULL
      AND (v_professional IS NULL OR c.cliente_id IS DISTINCT FROM v_professional);
  END IF;

  IF v_address IS NULL
     AND v_client IS NOT NULL
     AND (v_professional IS NULL OR v_client IS DISTINCT FROM v_professional) THEN
    SELECT nullif(btrim(p.direccion_texto), '')
      INTO v_address
    FROM public.profiles p
    WHERE p.id = v_client;
  END IF;

  RETURN v_address;
END;
$function$;

COMMENT ON FUNCTION public.get_store_request_client_address(uuid, uuid) IS
  'Calle de entrega para el comercio destinatario, para cotizar el flete. Prefiere la dirección temporal. No devuelve coordenadas ni el PIN.';

REVOKE ALL ON FUNCTION public.get_store_request_client_address(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_store_request_client_address(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_store_request_client_address(uuid, uuid) TO authenticated, service_role;

COMMIT;
