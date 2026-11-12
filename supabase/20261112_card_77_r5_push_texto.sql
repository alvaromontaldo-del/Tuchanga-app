-- #77 r5. Textos exactos de las push de rechazo, pidiendo «el siguiente motivo».
-- Reconstruido el 2026-11-12 desde pg_get_functiondef vivo de
-- antecedentes_rechazo_push_body(text). Solo cambia la frase.
--
-- notify_antecedentes_rechazo y notify_matricula_rechazo no se recrean:
-- la de antecedentes ya llama a esta función; la de matrícula manda el
-- motivo y la frase la arma la edge push_on_matricula (versión 4).
--
-- Frases exactas:
-- Foto de matrícula: «Algunas fotos de la verificación de la matrícula fueron rechazadas por el siguiente motivo: [motivo]».
-- Matrícula: «Tu matricula fue rechazada por el siguiente motivo: [motivo]».
-- Antecedentes: «La verificación de antecedentes penales fue rechazada por el siguiente motivo: [motivo].»
-- El punto final de antecedentes se agrega si el motivo no termina en . ! o ?
-- [motivo] es el que carga el admin.

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
  v_body := 'La verificación de antecedentes penales fue rechazada por el siguiente motivo: ' || v_motivo;
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
  '#77 r5. Arma el cuerpo de la push de rechazo de antecedentes. Sin EXECUTE para anon, authenticated ni service_role: la llama notify_antecedentes_rechazo (SECURITY DEFINER).';
