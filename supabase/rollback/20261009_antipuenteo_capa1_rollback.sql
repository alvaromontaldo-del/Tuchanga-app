-- Rollback de antipuenteo_capa1.
-- Definiciones vivas (pg_get_functiondef) capturadas el 2026-10-09
-- en el proyecto kyxehrxcdealbujvvnxp, antes de aplicar
-- supabase/20261009_antipuenteo_contacto.sql.
-- Correr en una sola transacción. Este archivo no trae BEGIN ni COMMIT.
--
-- md5(pg_get_functiondef):
--   contact_info_blocked_reason(text)                         0c24f2e5710ed958575f9b99c811d9b4
--   message_body_blocked_reason(text)                         57b9875112ca78e2a94b4d600c7d3b50
--   message_free_text_blocked_reason(text, text, jsonb)       6fc85a75837006a5db42ec354ccf25a6
--   enforce_message_rules()                                   179dc5f8b65d9d39b53becd5a850ef8b
--   enforce_quote_service_detail_rules()                      fd77f484d3a8a9a070fe6c0e69824aeb
--   recotizar_en_curso(uuid, numeric, text)                   3919a3c53093ad76284f43cc2e2e501e
--
-- Orden: se dropean los triggers nuevos, se restauran los cuerpos
-- vivos, se vuelve a crear trg_contrataciones_enforce_detail solo
-- sobre service_detail, y recién ahí se dropean las funciones y la
-- tabla nuevas.

DROP TRIGGER IF EXISTS trg_messages_redact_on_update ON public.messages;
DROP TRIGGER IF EXISTS trg_quotes_redact_offplatform ON public.quotes;
DROP TRIGGER IF EXISTS trg_quote_items_redact_offplatform ON public.quote_items;
DROP TRIGGER IF EXISTS trg_request_items_redact_offplatform ON public.request_items;
DROP TRIGGER IF EXISTS trg_recotizaciones_redact_offplatform ON public.recotizaciones;
DROP TRIGGER IF EXISTS trg_material_requests_redact_offplatform ON public.material_requests;
DROP TRIGGER IF EXISTS trg_contrataciones_enforce_detail ON public.contrataciones;

CREATE OR REPLACE FUNCTION public.contact_info_blocked_reason(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  t TEXT;
  token TEXT;
  digits TEXT;
BEGIN
  t := public.normalize_message_body(p_text);
  IF t = '' THEN
    RETURN NULL;
  END IF;

  IF t ~ '[a-z0-9._%+\-]+@[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}' THEN
    RETURN 'email';
  END IF;

  t := regexp_replace(t, '[$] *[0-9]{1,3}(?:[. ][0-9]{3})+(?:[.,][0-9]{1,2})?', ' ', 'g');
  t := regexp_replace(t, '[$] *[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?', ' ', 'g');
  t := regexp_replace(t, '[$] *[0-9]+(?:[.,][0-9]{1,2})?', ' ', 'g');

  IF EXISTS (
    SELECT 1
    FROM regexp_matches(t, '(^|[^0-9])([0-9]{8,15})([^0-9]|$)', 'g') AS m
  ) THEN
    RETURN 'telefono_num';
  END IF;

  FOR token IN
    SELECT x[1]
    FROM regexp_matches(
      t,
      '((?:\+ *)?(?:\([0-9]{1,4}\) *|[0-9]{1,4}[ -]+){1,6}[0-9]{2,4})',
      'g'
    ) AS x
  LOOP
    digits := regexp_replace(token, '[^0-9]', '', 'g');
    IF length(digits) BETWEEN 8 AND 15 THEN
      RETURN 'telefono_num';
    END IF;
  END LOOP;

  FOR token IN
    SELECT x[2]
    FROM regexp_matches(
      t,
      '(^|[^0-9])([0-9]{1,4}(?:\.[0-9]{2,4}){1,4})([^0-9]|$)',
      'g'
    ) AS x
  LOOP
    IF token ~ '^[0-9]{1,3}(?:\.[0-9]{3})+$' THEN
      CONTINUE;
    END IF;
    digits := regexp_replace(token, '[^0-9]', '', 'g');
    IF length(digits) BETWEEN 8 AND 15 THEN
      RETURN 'telefono_num';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.message_body_blocked_reason(p_text text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT public.contact_info_blocked_reason(p_text);
$function$
;

CREATE OR REPLACE FUNCTION public.message_free_text_blocked_reason(p_type text, p_body text, p_metadata jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  reason text;
  key text;
  val jsonb;
  elem jsonb;
  nested_key text;
  keys text[] := ARRAY[
    'service_detail', 'description', 'caption', 'notes', 'note',
    'detail', 'comment', 'label', 'title', 'text', 'message'
  ];
BEGIN
  IF coalesce(p_type, 'text') = 'system' THEN
    RETURN NULL;
  END IF;

  reason := public.contact_info_blocked_reason(p_body);
  IF reason IS NOT NULL THEN
    RETURN reason;
  END IF;

  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RETURN NULL;
  END IF;

  FOREACH key IN ARRAY keys LOOP
    val := p_metadata -> key;
    IF val IS NULL THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(val) = 'string' THEN
      reason := public.contact_info_blocked_reason(val #>> '{}');
      IF reason IS NOT NULL THEN
        RETURN reason;
      END IF;
    ELSIF jsonb_typeof(val) = 'array' THEN
      FOR elem IN SELECT value FROM jsonb_array_elements(val) LOOP
        IF jsonb_typeof(elem) = 'string' THEN
          reason := public.contact_info_blocked_reason(elem #>> '{}');
          IF reason IS NOT NULL THEN
            RETURN reason;
          END IF;
        ELSIF jsonb_typeof(elem) = 'object' THEN
          FOREACH nested_key IN ARRAY keys LOOP
            IF jsonb_typeof(elem -> nested_key) = 'string' THEN
              reason := public.contact_info_blocked_reason(elem ->> nested_key);
              IF reason IS NOT NULL THEN
                RETURN reason;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_message_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  recent_count INT;
  blocked_pair BOOLEAN;
  image_url TEXT;
  image_path TEXT;
  image_bucket TEXT;
  block_reason TEXT;
BEGIN
  IF coalesce(NEW.type, 'text') = 'system' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND (
          c.cliente_id = NEW.sender_id
          OR c.trabajador_id = NEW.sender_id
        )
    ) THEN
      RAISE EXCEPTION 'system_sender_not_participant' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF public.chat_cerrado_por_reclamo_conformidad(NEW.conversation_id) THEN
    RAISE EXCEPTION 'chat_cerrado_por_reclamo' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'sender_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.user_blocks b ON (
      (b.blocker_id = c.cliente_id AND b.blocked_id = c.trabajador_id)
      OR (b.blocker_id = c.trabajador_id AND b.blocked_id = c.cliente_id)
    )
    WHERE c.id = NEW.conversation_id
  ) INTO blocked_pair;

  IF blocked_pair THEN
    RAISE EXCEPTION 'user_blocked' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::int INTO recent_count
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '1 minute';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  block_reason := public.message_free_text_blocked_reason(
    NEW.type,
    NEW.body,
    coalesce(NEW.metadata, '{}'::jsonb)
  );
  IF block_reason IS NOT NULL THEN
    RAISE EXCEPTION 'message_blocked_contact' USING ERRCODE = 'P0001';
  END IF;

  IF char_length(coalesce(NEW.body, '')) > 2000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(NEW.type, 'text') = 'image' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = NEW.conversation_id
        AND c.cliente_id = NEW.sender_id
    ) THEN
      RAISE EXCEPTION 'image_client_only' USING ERRCODE = 'P0001';
    END IF;

    image_path := nullif(trim(coalesce(NEW.metadata->>'image_path', '')), '');
    image_bucket := nullif(trim(coalesce(NEW.metadata->>'image_bucket', '')), '');
    image_url := nullif(trim(coalesce(NEW.metadata->>'image_url', '')), '');

    IF image_path IS NOT NULL THEN
      IF coalesce(image_bucket, 'chat') <> 'chat'
         OR image_path ~ '(^|/)\.\.(/|$)'
         OR left(image_path, 1) = '/'
         OR image_path !~ '^[^/]+/chat/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$'
      THEN
        RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
      END IF;
    ELSIF image_url IS NULL OR image_url !~* '^https?://' THEN
      RAISE EXCEPTION 'image_url_required' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_quote_service_detail_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recotizar_en_curso(p_contratacion_id uuid, p_nuevo_precio_trabajador numeric, p_fundamentos text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_precios record;
  v_pagado numeric;
  v_comision numeric;
  v_precio_final numeric;
  v_neto numeric;
  v_fundamentos text;
  v_id uuid;
  v_monto_txt text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_row := public._assert_contratacion_participante(p_contratacion_id);

  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id
  FOR UPDATE;

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede recotizar' USING ERRCODE = '42501';
  END IF;

  IF v_row.estado_trabajo <> 'en_curso' THEN
    RAISE EXCEPTION 'Solo se puede recotizar con trabajo en curso';
  END IF;

  -- Falta acreditar la diferencia de la recotización anterior. Si se dejara
  -- proponer otra, el pago de esa diferencia (registrar_seña_aprobada) limpiaría
  -- la propuesta nueva a medias.
  IF v_row.estado_pago = 'pendiente_seña' THEN
    RAISE EXCEPTION 'Falta que el cliente pague la diferencia del costo de servicio';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pin_intentos
    WHERE contratacion_id = p_contratacion_id
      AND actor_id = auth.uid()
      AND exito = true
  ) THEN
    RAISE EXCEPTION 'Tenés que validar el PIN del cliente antes de recotizar';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.recotizaciones
    WHERE contratacion_id = p_contratacion_id
      AND estado = 'pendiente'
  ) OR v_row.recotizacion_precio_trabajador IS NOT NULL THEN
    RAISE EXCEPTION 'Ya hay una recotización pendiente';
  END IF;

  v_fundamentos := btrim(coalesce(p_fundamentos, ''));
  IF char_length(v_fundamentos) < 10 OR char_length(v_fundamentos) > 1000 THEN
    RAISE EXCEPTION 'Los fundamentos son obligatorios';
  END IF;

  IF p_nuevo_precio_trabajador IS NULL OR p_nuevo_precio_trabajador <= 0 THEN
    RAISE EXCEPTION 'precio_trabajador inválido';
  END IF;

  v_neto := ceil(p_nuevo_precio_trabajador);
  IF v_neto = ceil(v_row.precio_trabajador) THEN
    RAISE EXCEPTION 'El monto nuevo tiene que ser distinto del actual';
  END IF;

  -- #39: calc_precios_contratacion usa calc_yachanga_service_fee.
  SELECT * INTO v_precios FROM public.calc_precios_contratacion(v_neto);
  v_comision := v_precios.comision_app;
  v_precio_final := v_precios.precio_final;

  SELECT coalesce(sum(monto), 0) INTO v_pagado
  FROM public.transacciones_pago
  WHERE contratacion_id = p_contratacion_id
    AND estado_mp = 'approved'
    AND tipo_pago IN ('seña_inicial', 'diferencia_seña');
  IF v_row.estado_pago IN ('seña_pagada', 'totalmente_pagado') THEN
    v_pagado := greatest(v_pagado, v_row.comision_app);
  END IF;

  -- #4 opción A: el cliente no paga nada más, ni la diferencia del costo de
  -- servicio. #39 sigue vigente: tampoco hay devolución. La comisión queda
  -- en lo ya pagado aunque el tramo nuevo sea más alto.
  v_precio_final := v_precio_final - v_comision + v_pagado;
  v_comision := v_pagado;

  INSERT INTO public.recotizaciones (
    contratacion_id,
    worker_id,
    client_id,
    precio_trabajador_anterior,
    precio_final_anterior,
    comision_app_anterior,
    precio_trabajador_nuevo,
    precio_final_nuevo,
    comision_app_nuevo,
    fundamentos,
    estado
  )
  VALUES (
    p_contratacion_id,
    v_row.worker_id,
    v_row.client_id,
    v_row.precio_trabajador,
    v_row.precio_final,
    v_row.comision_app,
    v_neto,
    v_precio_final,
    v_comision,
    v_fundamentos,
    'pendiente'
  )
  RETURNING id INTO v_id;

  UPDATE public.contrataciones
  SET
    recotizacion_id = v_id,
    recotizacion_fundamentos = v_fundamentos,
    recotizacion_precio_trabajador = v_neto,
    recotizacion_precio_final = v_precio_final,
    recotizacion_comision_app = v_comision,
    estado_trabajo = 'pendiente_pago_diferencia'
  WHERE id = p_contratacion_id;

  v_monto_txt := '$' || regexp_replace(trunc(v_neto)::bigint::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'El profesional propone un nuevo monto para el trabajo.' || E'\n'
      || 'Pago al profesional: ' || v_monto_txt || E'\n'
      || 'Fundamentos: ' || v_fundamentos,
    jsonb_build_object(
      'event', 'recotizacion_propuesta',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_id,
      'audience', 'cliente',
      'fundamentos', v_fundamentos,
      'precio_trabajador_anterior', v_row.precio_trabajador,
      'precio_trabajador', v_neto,
      'precio_final', v_precio_final,
      'comision_app', v_comision
    )
  );

  PERFORM public._chat_insert_system_event(
    v_row.conversation_id,
    v_row.worker_id,
    'Enviaste una recotización de ' || v_monto_txt || '.' || E'\n'
      || 'Fundamentos: ' || v_fundamentos || E'\n'
      || 'El cliente tiene que aceptarla o rechazarla.',
    jsonb_build_object(
      'event', 'recotizacion_propuesta_trabajador',
      'contratacion_id', p_contratacion_id,
      'recotizacion_id', v_id,
      'audience', 'trabajador',
      'fundamentos', v_fundamentos,
      'precio_trabajador_anterior', v_row.precio_trabajador,
      'precio_trabajador', v_neto
    )
  );
END;
$function$
;


CREATE TRIGGER trg_contrataciones_enforce_detail
  BEFORE INSERT OR UPDATE OF service_detail
  ON public.contrataciones
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_service_detail_rules();

COMMENT ON FUNCTION public.contact_info_blocked_reason(text) IS
  'Filtro relajado: email o teléfono real. No bloquea cinta, cable, calor ni importes.';
COMMENT ON FUNCTION public.message_body_blocked_reason(text) IS
  'Desactivada (2026-09-25): el chat ya no rechaza el cuerpo por datos de contacto.';
COMMENT ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) IS
  'El trabajador, con PIN validado, propone un monto nuevo y fundamentos. Queda pendiente. No aplica el precio hasta que el cliente acepta. Costo de servicio con el piso de #39.';

DROP FUNCTION IF EXISTS public.redact_message_on_update();
DROP FUNCTION IF EXISTS public.redact_offplatform_row();
DROP FUNCTION IF EXISTS public.redact_offplatform_metadata(jsonb, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.redact_offplatform_metadata(jsonb, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.redact_offplatform_field(text, text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.redact_offplatform_contextual(text, text, uuid, text, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.redact_offplatform_contact(text);
DROP FUNCTION IF EXISTS public._offplatform_profile_spans(text, text, text[], text[], text, text, text);
DROP FUNCTION IF EXISTS public._offplatform_apply_spans(text, int[], int[]);
DROP FUNCTION IF EXISTS public._offplatform_address_parts(text);
DROP FUNCTION IF EXISTS public._offplatform_phone_tails(text);
DROP FUNCTION IF EXISTS public._offplatform_blank_noise(text);
DROP FUNCTION IF EXISTS public._offplatform_phone_digits(text);
DROP FUNCTION IF EXISTS public._offplatform_to_digits(text);
DROP FUNCTION IF EXISTS public._offplatform_overlaps(int, int, int[], int[]);
DROP FUNCTION IF EXISTS public._offplatform_fold(text);

DROP TABLE IF EXISTS public.offplatform_contact_detections;

DELETE FROM supabase_migrations.schema_migrations
WHERE name = 'antipuenteo_capa1';
