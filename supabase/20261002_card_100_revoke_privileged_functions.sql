-- Card #100 (re-auditoría 2026-10-02): cerrar funciones SECURITY DEFINER a anon.
-- Proyecto: TuChangaAPP (kyxehrxcdealbujvvnxp).
--
-- Antes: anon podía ejecutar 110 funciones SECURITY DEFINER y authenticated 147.
-- Siete escribían datos sin controlar quién llamaba (sync_auth_phone_from_profile,
-- archive_account_baja, reject_stale_material_quotes, link_professional_history_for_user,
-- try_archive_chat_after_job_complete, auto_approve_stale_warranty_claims, claim_push_delivery).
--
-- Mapa de llamadores (app main, admin, landing, edge functions, triggers, otras funciones,
-- policies RLS, vistas, defaults): ver comentario de la tarjeta #100 en Trello.
--
-- Reglas:
--  1) Funciones internas (triggers, event trigger y helpers que solo llaman otras funciones
--     del servidor, triggers o edge functions con service_role): sin EXECUTE para PUBLIC,
--     anon ni authenticated. Los triggers se disparan igual (el permiso se mira al crear
--     el trigger, no al dispararlo).
--  2) Funciones que la app llama con sesión: se quita PUBLIC y anon; authenticated sigue.
--  3) Funciones públicas de verdad (landing, búsqueda, chequeos de registro/login y is_admin,
--     que usa la policy professional_trades_select_all para anon): no se tocan.
--  4) try_archive_chat_after_job_complete: la app la llama con sesión (best-effort), así que
--     se agrega control: si hay usuario logueado, tiene que ser cliente o profesional del
--     trabajo, o admin. Cuerpo reconstruido desde pg_get_functiondef de producción;
--     solo se agregó el bloque marcado «#100».
--  Las funciones de PostGIS (st_estimatedextent) son de la extensión y no se tocan.

CREATE OR REPLACE FUNCTION public.try_archive_chat_after_job_complete(p_contratacion_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_review_at timestamptz;
  v_ready_at timestamptz;
  v_days integer := public.chat_cleanup_retention_days();
BEGIN
  SELECT * INTO v_row
  FROM public.contrataciones
  WHERE id = p_contratacion_id;

  IF NOT FOUND OR v_row.conversation_id IS NULL THEN
    RETURN false;
  END IF;

  -- #100: un usuario logueado solo puede pedirlo para un trabajo propio (o admin).
  -- Triggers y edge functions (service_role, sin auth.uid()) siguen igual.
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM v_row.client_id
     AND auth.uid() IS DISTINCT FROM v_row.worker_id
     AND NOT public.is_admin() THEN
    RETURN false;
  END IF;

  -- Reclamo de garantía activo: el hilo debe permanecer usable.
  IF coalesce(v_row.is_claim_open, false) THEN
    RETURN false;
  END IF;

  IF v_row.estado_pago IS DISTINCT FROM 'totalmente_pagado' THEN
    RETURN false;
  END IF;

  IF v_row.offline_pago_confirmado_at IS NULL AND v_row.paid_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT wr.created_at INTO v_review_at
  FROM public.worker_reviews wr
  WHERE wr.job_id = p_contratacion_id
     OR wr.conversation_id = v_row.conversation_id
  ORDER BY wr.created_at ASC
  LIMIT 1;

  IF v_review_at IS NULL THEN
    RETURN false;
  END IF;

  v_ready_at := GREATEST(
    v_review_at,
    coalesce(v_row.offline_pago_confirmado_at, v_row.paid_at, v_review_at)
  );

  IF v_ready_at > (now() - make_interval(days => GREATEST(0, v_days))) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.contrataciones a
    WHERE a.conversation_id = v_row.conversation_id
      AND a.id <> p_contratacion_id
      AND (
        a.estado_trabajo NOT IN ('finalizado', 'cancelado', 'disputa')
        OR coalesce(a.is_claim_open, false)
      )
  ) THEN
    RETURN false;
  END IF;

  PERFORM public.hide_conversation_for_participants(v_row.conversation_id);

  UPDATE public.contrataciones
  SET chat_archived_at = coalesce(chat_archived_at, now())
  WHERE id = p_contratacion_id;

  RETURN true;
END;
$function$;

-- 1) Internas: solo servidor (postgres / service_role).
REVOKE EXECUTE ON FUNCTION
  public.archive_account_baja(p_user_id uuid, p_origin text, p_user_type text, p_notes text),
  public.auto_approve_stale_warranty_claims(),
  public.chat_cerrado_por_reclamo_conformidad(p_conversation_id uuid),
  public.claim_push_delivery(p_event_key text),
  public.conversation_tiene_trabajo_vivo(p_conversation_id uuid),
  public.enforce_message_rules(),
  public.enforce_post_description_rules(),
  public.enforce_quote_service_detail_rules(),
  public.generate_store_order_code(),
  public.is_professional_user(p_user_id uuid),
  public.link_professional_history_for_user(p_user_id uuid),
  public.material_requests_apply_client_job_address(),
  public.on_worker_review_insert(),
  public.on_worker_review_try_archive_chat(),
  public.reject_stale_material_quotes(p_max_age interval),
  public.rls_auto_enable(),
  public.store_is_eligible_for_quotes(p_store_id uuid),
  public.sync_auth_phone_from_profile(p_user_id uuid, p_phone text),
  public.touch_chat_quote_updated_at(),
  public.touch_contratacion_updated_at(),
  public.touch_conversation_on_message(),
  public.touch_service_job_updated_at(),
  public.trg_auth_user_archive_professional_on_delete(),
  public.trg_auth_user_link_professional_history(),
  public.trg_cleanup_chat_images_http(),
  public.trg_contratacion_set_warranty_anchor(),
  public.trg_jobs_maybe_professional_pending(),
  public.trg_orders_set_order_code(),
  public.trg_profiles_set_deactivation_origin(),
  public.trg_profiles_sync_auth_phone(),
  public.trg_quotes_mark_target_quoted(),
  public.trg_quotes_on_accepted(),
  public.trg_quotes_on_sent(),
  public.trg_quotes_set_client_id(),
  public.trg_request_target_store_push_new()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.archive_account_baja(p_user_id uuid, p_origin text, p_user_type text, p_notes text),
  public.auto_approve_stale_warranty_claims(),
  public.chat_cerrado_por_reclamo_conformidad(p_conversation_id uuid),
  public.claim_push_delivery(p_event_key text),
  public.conversation_tiene_trabajo_vivo(p_conversation_id uuid),
  public.enforce_message_rules(),
  public.enforce_post_description_rules(),
  public.enforce_quote_service_detail_rules(),
  public.generate_store_order_code(),
  public.is_professional_user(p_user_id uuid),
  public.link_professional_history_for_user(p_user_id uuid),
  public.material_requests_apply_client_job_address(),
  public.on_worker_review_insert(),
  public.on_worker_review_try_archive_chat(),
  public.reject_stale_material_quotes(p_max_age interval),
  public.rls_auto_enable(),
  public.store_is_eligible_for_quotes(p_store_id uuid),
  public.sync_auth_phone_from_profile(p_user_id uuid, p_phone text),
  public.touch_chat_quote_updated_at(),
  public.touch_contratacion_updated_at(),
  public.touch_conversation_on_message(),
  public.touch_service_job_updated_at(),
  public.trg_auth_user_archive_professional_on_delete(),
  public.trg_auth_user_link_professional_history(),
  public.trg_cleanup_chat_images_http(),
  public.trg_contratacion_set_warranty_anchor(),
  public.trg_jobs_maybe_professional_pending(),
  public.trg_orders_set_order_code(),
  public.trg_profiles_set_deactivation_origin(),
  public.trg_profiles_sync_auth_phone(),
  public.trg_quotes_mark_target_quoted(),
  public.trg_quotes_on_accepted(),
  public.trg_quotes_on_sent(),
  public.trg_quotes_set_client_id(),
  public.trg_request_target_store_push_new()
TO service_role;

-- 2) Con sesión: fuera PUBLIC y anon; authenticated y service_role siguen.
REVOKE EXECUTE ON FUNCTION
  public.accept_material_quote(p_quote_id uuid, p_accepted_item_ids uuid[], p_include_freight boolean),
  public.aceptar_disponibilidad(p_contratacion_id uuid),
  public.aceptar_disponibilidad_opcion(p_opcion_id uuid),
  public.aceptar_precio_cotizado(p_contratacion_id uuid),
  public.aceptar_reagendar_visita(p_opcion_id uuid),
  public.aceptar_recotizacion(p_contratacion_id uuid),
  public."aplicar_seña_con_credito"(p_contratacion_id uuid),
  public.cliente_notificar_pago_offline(p_contratacion_id uuid),
  public.cliente_responder_conformidad(p_contratacion_id uuid, p_conforme boolean, p_motivo_disputa text),
  public.completar_orden_material_con_pin(p_order_code text, p_pin text),
  public.confirmar_arreglo_garantia(p_contratacion_id uuid),
  public.create_material_checkout(p_selections jsonb),
  public.deactivate_professional_profile(),
  public.delete_conversation(p_conversation_id uuid),
  public.delete_user_account(),
  public.ensure_my_client_profile(p_avatar_url text),
  public.get_peer_read_ats(p_conversation_ids uuid[]),
  public.get_total_unread_count(),
  public.get_unread_counts(p_conversation_ids uuid[]),
  public.hide_conversation(p_conversation_id uuid),
  public.hide_post(p_publicacion_id uuid),
  public.insert_profile_with_location(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text, p_coverage_km integer, p_bio text, p_document_type text),
  public.is_material_request_party(p_request_id uuid),
  public.is_store_owner(p_store_id uuid),
  public.link_professional_history(),
  public.list_client_contracted_jobs(),
  public.list_favorites(),
  public.list_material_quote_freight_flags(p_request_id uuid),
  public.marcar_arreglo_garantia_terminado(p_contratacion_id uuid),
  public.notify_material_quote_in_chat(p_quote_id uuid),
  public.obtener_direccion_cliente(p_contratacion_id uuid),
  public.obtener_pin_cliente(p_contratacion_id uuid),
  public.pause_professional_service(),
  public.proponer_disponibilidad(p_contratacion_id uuid, p_fecha_trabajo date, p_hora_inicio time without time zone, p_hora_fin time without time zone),
  public.proponer_disponibilidad_opciones(p_contratacion_id uuid, p_opciones jsonb),
  public.proponer_reagendar_visita(p_contratacion_id uuid, p_opciones jsonb),
  public.reactivate_professional_profile(),
  public.rechazar_disponibilidad(p_contratacion_id uuid),
  public.rechazar_precio_cotizado(p_contratacion_id uuid),
  public.rechazar_reagendar_visita(p_contratacion_id uuid),
  public.rechazar_recotizacion(p_contratacion_id uuid),
  public.recotizar_en_curso(p_contratacion_id uuid, p_nuevo_precio_trabajador numeric),
  public.reject_material_quote(p_quote_id uuid),
  public.resume_professional_service(),
  public.set_my_avatar_url(p_url text),
  public.set_my_store_avatar_url(p_store_id uuid, p_url text),
  public.storage_owner_folder_for_me(),
  public.store_can_see_request(p_request_id uuid),
  public.store_is_request_target(p_request_id uuid, p_store_id uuid),
  public.sync_my_auth_phone(p_phone text),
  public.toggle_favorite(p_professional_id uuid),
  public.toggle_post_like(p_post_id uuid),
  public.trabajador_confirmar_recepcion_offline(p_contratacion_id uuid),
  public.trabajador_finalizar_trabajo(p_contratacion_id uuid),
  public.try_archive_chat_after_job_complete(p_contratacion_id uuid),
  public.update_professional_description(p_description text),
  public.update_profile_extras(p_birth_date text, p_detalles_ubicacion text, p_touch_birth_date boolean, p_touch_detalles boolean),
  public.update_profile_geo_coverage(p_direccion text, p_lat double precision, p_lng double precision, p_coverage_km integer),
  public.update_profile_registration(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text, p_bio text),
  public.update_profile_registration_full(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text, p_detalles_ubicacion text, p_birth_date text, p_touch_detalles boolean, p_touch_birth_date boolean, p_document_type text),
  public.update_profile_registration_no_bio(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text),
  public.update_worker_jobs(p_jobs jsonb),
  public.verificar_pin(p_contratacion_id uuid, p_pin_ingresado text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.accept_material_quote(p_quote_id uuid, p_accepted_item_ids uuid[], p_include_freight boolean),
  public.aceptar_disponibilidad(p_contratacion_id uuid),
  public.aceptar_disponibilidad_opcion(p_opcion_id uuid),
  public.aceptar_precio_cotizado(p_contratacion_id uuid),
  public.aceptar_reagendar_visita(p_opcion_id uuid),
  public.aceptar_recotizacion(p_contratacion_id uuid),
  public."aplicar_seña_con_credito"(p_contratacion_id uuid),
  public.cliente_notificar_pago_offline(p_contratacion_id uuid),
  public.cliente_responder_conformidad(p_contratacion_id uuid, p_conforme boolean, p_motivo_disputa text),
  public.completar_orden_material_con_pin(p_order_code text, p_pin text),
  public.confirmar_arreglo_garantia(p_contratacion_id uuid),
  public.create_material_checkout(p_selections jsonb),
  public.deactivate_professional_profile(),
  public.delete_conversation(p_conversation_id uuid),
  public.delete_user_account(),
  public.ensure_my_client_profile(p_avatar_url text),
  public.get_peer_read_ats(p_conversation_ids uuid[]),
  public.get_total_unread_count(),
  public.get_unread_counts(p_conversation_ids uuid[]),
  public.hide_conversation(p_conversation_id uuid),
  public.hide_post(p_publicacion_id uuid),
  public.insert_profile_with_location(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text, p_coverage_km integer, p_bio text, p_document_type text),
  public.is_material_request_party(p_request_id uuid),
  public.is_store_owner(p_store_id uuid),
  public.link_professional_history(),
  public.list_client_contracted_jobs(),
  public.list_favorites(),
  public.list_material_quote_freight_flags(p_request_id uuid),
  public.marcar_arreglo_garantia_terminado(p_contratacion_id uuid),
  public.notify_material_quote_in_chat(p_quote_id uuid),
  public.obtener_direccion_cliente(p_contratacion_id uuid),
  public.obtener_pin_cliente(p_contratacion_id uuid),
  public.pause_professional_service(),
  public.proponer_disponibilidad(p_contratacion_id uuid, p_fecha_trabajo date, p_hora_inicio time without time zone, p_hora_fin time without time zone),
  public.proponer_disponibilidad_opciones(p_contratacion_id uuid, p_opciones jsonb),
  public.proponer_reagendar_visita(p_contratacion_id uuid, p_opciones jsonb),
  public.reactivate_professional_profile(),
  public.rechazar_disponibilidad(p_contratacion_id uuid),
  public.rechazar_precio_cotizado(p_contratacion_id uuid),
  public.rechazar_reagendar_visita(p_contratacion_id uuid),
  public.rechazar_recotizacion(p_contratacion_id uuid),
  public.recotizar_en_curso(p_contratacion_id uuid, p_nuevo_precio_trabajador numeric),
  public.reject_material_quote(p_quote_id uuid),
  public.resume_professional_service(),
  public.set_my_avatar_url(p_url text),
  public.set_my_store_avatar_url(p_store_id uuid, p_url text),
  public.storage_owner_folder_for_me(),
  public.store_can_see_request(p_request_id uuid),
  public.store_is_request_target(p_request_id uuid, p_store_id uuid),
  public.sync_my_auth_phone(p_phone text),
  public.toggle_favorite(p_professional_id uuid),
  public.toggle_post_like(p_post_id uuid),
  public.trabajador_confirmar_recepcion_offline(p_contratacion_id uuid),
  public.trabajador_finalizar_trabajo(p_contratacion_id uuid),
  public.try_archive_chat_after_job_complete(p_contratacion_id uuid),
  public.update_professional_description(p_description text),
  public.update_profile_extras(p_birth_date text, p_detalles_ubicacion text, p_touch_birth_date boolean, p_touch_detalles boolean),
  public.update_profile_geo_coverage(p_direccion text, p_lat double precision, p_lng double precision, p_coverage_km integer),
  public.update_profile_registration(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text, p_bio text),
  public.update_profile_registration_full(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text, p_detalles_ubicacion text, p_birth_date text, p_touch_detalles boolean, p_touch_birth_date boolean, p_document_type text),
  public.update_profile_registration_no_bio(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text),
  public.update_worker_jobs(p_jobs jsonb),
  public.verificar_pin(p_contratacion_id uuid, p_pin_ingresado text)
TO authenticated, service_role;

-- 3) Sin cambios (uso anónimo real): search_workers_public, list_public_worker_categories,
--    get_public_worker_profile, get_public_post, search_workers_for_client, fetch_worker_trades,
--    fetch_worker_posts, fetch_feed_posts, auth_email_is_registered, profile_dni_is_registered,
--    profile_phone_is_registered, get_my_deactivation_reason, is_admin.
