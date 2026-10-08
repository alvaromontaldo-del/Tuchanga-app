-- YaChanga #208 — PIN de trabajo: mensaje identificable y contador al vencer el bloqueo.
-- #204 (cambio de rol) y #206 (Maps con la dirección) son solo de app: no hay SQL.
--
-- Cuerpo reconstruido desde pg_get_functiondef('public.verificar_pin(uuid, text)')
-- en producción el 2026-10-08. Firma boolean, guards y grants iguales.
-- anon no tiene EXECUTE.
--
-- Cambios:
--   * Si pin_bloqueado_hasta ya pasó, el contador vuelve a 0 antes de evaluar.
--     Si no, el próximo fallo (el contador seguía en 5) rebloquea al toque.
--   * Con el bloqueo vigente: RAISE 'pin_bloqueado' y la hora ISO en DETAIL.
--   * El 5º fallo sigue devolviendo false después del UPDATE. Un RAISE ahí
--     desharía el UPDATE en la misma transacción del RPC.
--   * PIN correcto: sigue pasando a en_curso y pone el contador en 0.

BEGIN;

CREATE OR REPLACE FUNCTION public.verificar_pin(p_contratacion_id uuid, p_pin_ingresado text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contrataciones%rowtype;
  v_ok boolean;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede verificar el PIN';
  END IF;

  IF v_row.estado_trabajo <> 'aceptado' OR v_row.estado_pago <> 'seña_pagada' THEN
    RAISE EXCEPTION 'Estado inválido para verificar PIN';
  END IF;

  IF v_row.pin_bloqueado_hasta IS NOT NULL AND v_row.pin_bloqueado_hasta > now() THEN
    RAISE EXCEPTION 'pin_bloqueado'
      USING DETAIL = to_jsonb(v_row.pin_bloqueado_hasta) #>> '{}';
  END IF;

  IF v_row.pin_bloqueado_hasta IS NOT NULL AND v_row.pin_bloqueado_hasta <= now() THEN
    UPDATE public.contrataciones
    SET
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL
    WHERE id = p_contratacion_id;
  END IF;

  v_ok := v_row.verification_pin IS NOT NULL
    AND lpad(trim(coalesce(p_pin_ingresado, '')), 4, '0') = v_row.verification_pin;

  INSERT INTO public.pin_intentos (contratacion_id, actor_id, pin_ingresado, exito)
  VALUES (p_contratacion_id, auth.uid(), coalesce(p_pin_ingresado, ''), v_ok);

  IF v_ok THEN
    UPDATE public.contrataciones
    SET
      estado_trabajo = 'en_curso',
      pin_intentos_fallidos = 0,
      pin_bloqueado_hasta = NULL
    WHERE id = p_contratacion_id;

    PERFORM public._chat_insert_system_event(
      v_row.conversation_id,
      v_row.worker_id,
      'El trabajador ha validado el PIN. El trabajo ha pasado a estado: En curso.',
      jsonb_build_object(
        'event', 'pin_validado',
        'contratacion_id', p_contratacion_id,
        'audience', 'cliente'
      )
    );

    RETURN true;
  END IF;

  UPDATE public.contrataciones
  SET
    pin_intentos_fallidos = pin_intentos_fallidos + 1,
    pin_bloqueado_hasta = CASE
      WHEN pin_intentos_fallidos + 1 >= 5 THEN now() + interval '15 minutes'
      ELSE pin_bloqueado_hasta
    END
  WHERE id = p_contratacion_id;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.verificar_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verificar_pin(uuid, text) TO authenticated, service_role;

COMMIT;
