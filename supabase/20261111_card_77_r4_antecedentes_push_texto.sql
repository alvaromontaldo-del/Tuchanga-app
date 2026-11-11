-- #77 r4. Texto de la push al rechazar el certificado de antecedentes.
-- Reconstruido el 2026-11-11 desde pg_get_functiondef vivo de
-- notify_antecedentes_rechazo(uuid, text, text).
--
-- admin_rechazar_antecedentes_penales no se toca: sigue guardando en
-- rejection_reason solo el motivo que escribió el admin (eso es lo que
-- ve el profesional en la pantalla). La frase completa se arma acá y
-- viaja en el webhook a push_on_antecedentes, que ya usa "asunto" como
-- cuerpo de la push.
--
-- Frase exacta: «La verificación de antecedentes penales fue rechazada por [motivo].»
-- El punto final se agrega si el motivo no termina en . ! o ?
--
-- La push de foto de matrícula no está en este SQL: la arma la edge
-- push_on_matricula (matriculaRechazoPush). Texto nuevo:
-- «Algunas fotos de la verificación de la matrícula fueron rechazadas por el motivo: [motivo]».
-- «Tu matricula fue rechazada por [motivo]» no cambia.
-- notify_matricula_rechazo no se recrea.

CREATE OR REPLACE FUNCTION public.antecedentes_rechazo_push_body(p_motivo text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  v_body text;
BEGIN
  IF v_motivo = '' THEN
    RETURN NULL;
  END IF;
  v_body := 'La verificación de antecedentes penales fue rechazada por ' || v_motivo;
  IF right(v_body, 1) NOT IN ('.', '!', '?') THEN
    v_body := v_body || '.';
  END IF;
  RETURN v_body;
END;
$function$;

REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM anon;
REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM service_role;

COMMENT ON FUNCTION public.antecedentes_rechazo_push_body(text) IS
  '#77 r4. Arma el cuerpo de la push de rechazo de antecedentes. Sin EXECUTE para anon, authenticated ni service_role: la llama notify_antecedentes_rechazo (SECURITY DEFINER).';

CREATE OR REPLACE FUNCTION public.notify_antecedentes_rechazo(p_user_id uuid, p_asunto text, p_event_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_body text;
BEGIN
  v_body := public.antecedentes_rechazo_push_body(p_asunto);
  IF p_user_id IS NULL OR v_body IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.invoke_vault_edge_webhook(
    'push_on_antecedentes',
    jsonb_build_object(
      'type', 'UPDATE',
      'table', 'antecedentes_penales',
      'schema', 'public',
      'record', jsonb_build_object(
        'user_id', p_user_id,
        'asunto', v_body,
        'event_key', left(coalesce(p_event_key, ''), 240)
      ),
      'old_record', NULL
    ),
    5000
  );
END;
$function$;

-- CREATE OR REPLACE conserva los grants. Se reafirman los que ya estaban.
REVOKE ALL ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) IS
  '#77 r4. Push al profesional con la frase de rechazo de antecedentes y el motivo del admin. Delega en invoke_vault_edge_webhook. Sin EXECUTE para anon ni authenticated.';
