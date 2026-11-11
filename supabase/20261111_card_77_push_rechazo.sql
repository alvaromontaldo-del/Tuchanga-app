-- #77. Push de rechazo más clara.
-- Cuerpo vivo: notify_matricula_rechazo de 20261015_card_77_matricula.sql.
-- Único cambio: el payload lleva kind = foto | matricula, según la event_key
-- que ya arman admin_rechazar_matricula_foto y admin_rechazar_matricula_oficio.
-- La frase visible la escribe la edge push_on_matricula. Hay que redeployarla.
-- Sin EXECUTE para anon.

CREATE OR REPLACE FUNCTION public.notify_matricula_rechazo(
  p_user_id uuid,
  p_motivo text,
  p_event_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := left(coalesce(p_event_key, ''), 240);
BEGIN
  IF p_user_id IS NULL OR btrim(coalesce(p_motivo, '')) = '' THEN
    RETURN;
  END IF;

  PERFORM public.invoke_vault_edge_webhook(
    'push_on_matricula',
    jsonb_build_object(
      'type', 'UPDATE',
      'table', 'matriculas',
      'schema', 'public',
      'record', jsonb_build_object(
        'user_id', p_user_id,
        'motivo', btrim(p_motivo),
        'event_key', v_key,
        'kind', CASE
          WHEN v_key ~* '^matricula:[0-9a-f-]{36}:[0-9a-f-]{36}:' THEN 'foto'
          ELSE 'matricula'
        END
      ),
      'old_record', NULL
    ),
    5000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_matricula_rechazo(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_matricula_rechazo(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.notify_matricula_rechazo(uuid, text, text) IS
  '#77. Avisa el rechazo de una foto o de la matrícula. kind distingue el texto de la push. Sin EXECUTE para anon ni authenticated.';
