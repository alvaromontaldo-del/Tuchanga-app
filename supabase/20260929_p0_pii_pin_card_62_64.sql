-- YaChanga P0 #62 y #64 — fase 1 (aditiva) + fase 2 comentada.
--
-- NO aplicar la fase 2 en el mismo paso que este archivo.
-- Orden:
--   1. Ejecutar solo el bloque FASE 1 (este archivo, hasta el COMMIT).
--   2. Publicar el OTA con la app que ya no lee verification_pin ni las
--      columnas PII de profiles.
--   3. Recién entonces descomentar y ejecutar FASE 2.
--
-- FASE 1 no revoca privilegios. Crea dos RPC SECURITY DEFINER:
--   get_my_profile_private()       PII del propio auth.uid()
--   get_job_client_location(uuid)  domicilio del cliente solo para el
--                                  trabajador, y solo con seña o total pago
--
-- EXECUTE queda solo para authenticated. Sin anon y sin service_role.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_profile_private()
RETURNS TABLE (
  dni text,
  telefono text,
  direccion_texto text,
  detalles_ubicacion text,
  birth_date date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  RETURN QUERY
  SELECT
    p.dni,
    p.telefono,
    p.direccion_texto,
    p.detalles_ubicacion,
    p.birth_date
  FROM public.profiles p
  WHERE p.id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.get_my_profile_private() IS
  'PII del usuario autenticado (auth.uid() únicamente). No acepta un id ajeno.';

REVOKE ALL ON FUNCTION public.get_my_profile_private() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile_private() FROM anon;
REVOKE ALL ON FUNCTION public.get_my_profile_private() FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_job_client_location(p_contratacion_id uuid)
RETURNS TABLE (
  direccion_texto text,
  detalles_ubicacion text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker uuid;
  v_client uuid;
  v_estado public.contratacion_estado_pago;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_contratacion_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.worker_id, c.client_id, c.estado_pago
    INTO v_worker, v_client, v_estado
  FROM public.contrataciones c
  WHERE c.id = p_contratacion_id;

  -- Sin fila, sin ser el trabajador, o sin pago: no devolver domicilio.
  IF NOT FOUND OR v_worker IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;

  IF v_estado NOT IN ('seña_pagada', 'totalmente_pagado') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.direccion_texto,
    NULLIF(btrim(p.detalles_ubicacion), '')
  FROM public.profiles p
  WHERE p.id = v_client;
END;
$$;

COMMENT ON FUNCTION public.get_job_client_location(uuid) IS
  'Domicilio del cliente de una contratación. Solo si auth.uid() es worker_id y estado_pago es seña_pagada o totalmente_pagado.';

REVOKE ALL ON FUNCTION public.get_job_client_location(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_job_client_location(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_job_client_location(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_job_client_location(uuid) TO authenticated;

COMMIT;

-- =============================================================================
-- FASE 2 — NO EJECUTAR hasta que el OTA con la fase 1 esté en producción.
--
-- El bloque de abajo está comentado a propósito. Descomentarlo y correrlo
-- solo después de verificar que la app ya no selecciona verification_pin
-- ni dni / telefono / direccion_texto / detalles_ubicacion / birth_date.
--
-- location de profiles NO se revoca: la búsqueda usa RPC SECURITY DEFINER.
--
-- Realtime: postgres_changes de contrataciones tiene que seguir entregando
-- eventos después del GRANT por columna. Ver el cuerpo del PR (cómo verificar).
-- Si has_column_privilege de las columnas PII de profiles sigue en true,
-- el GRANT SELECT de tabla pisa este REVOKE de columna. En ese caso hace
-- falta revocar el SELECT de tabla y reotorgar el resto de columnas,
-- incluida location, sin las cinco de PII. Listarlas con:
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles'
--   ORDER BY ordinal_position;
-- =============================================================================
/*
BEGIN;

REVOKE SELECT ON public.contrataciones FROM authenticated;
GRANT SELECT (
  id,
  conversation_id,
  worker_id,
  client_id,
  precio_trabajador,
  precio_final,
  comision_app,
  service_detail,
  estado_trabajo,
  estado_pago,
  fecha_trabajo,
  hora_inicio,
  hora_fin,
  pin_intentos_fallidos,
  pin_bloqueado_hasta,
  recotizacion_precio_trabajador,
  recotizacion_precio_final,
  recotizacion_comision_app,
  paid_at,
  seña_pagada_at,
  completed_by_worker_at,
  finalizado_at,
  cancelado_at,
  conformidad_solicitada_at,
  conformidad_respondida_at,
  conformidad_aceptada,
  is_claim_open,
  claim_status,
  claim_opened_at,
  claim_marked_done_at,
  claim_resolved_at,
  offline_pago_notificado_at,
  offline_pago_confirmado_at,
  disputa_motivo,
  chat_archived_at,
  warranty_days,
  warranty_anchor_at,
  created_at,
  updated_at
) ON public.contrataciones TO authenticated;

REVOKE SELECT (dni, telefono, direccion_texto, detalles_ubicacion, birth_date)
  ON public.profiles FROM authenticated;

COMMIT;
*/
