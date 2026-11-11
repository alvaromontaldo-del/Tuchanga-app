-- #214. Sellos públicos para la búsqueda y el perfil.
-- El feed ya los trae en fetch_feed_posts (card_77_214). Esta función lista
-- los mismos helpers por ids, sin reescribir search_workers_for_client.
-- No devuelve número, entidad, fotos ni el legado sin_vincular.
-- EXECUTE solo para authenticated y service_role.

CREATE OR REPLACE FUNCTION public.worker_public_trust(p_user_ids uuid[])
RETURNS TABLE(profile_id uuid, antecedentes_penales boolean, matriculas_verificadas text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    ids.user_id AS profile_id,
    public._worker_antecedentes_aprobado(ids.user_id) AS antecedentes_penales,
    public._matriculas_oficios_verificados(ids.user_id) AS matriculas_verificadas
  FROM (
    SELECT DISTINCT u AS user_id
    FROM unnest(coalesce(p_user_ids, '{}'::uuid[])) AS u
    WHERE u IS NOT NULL
    LIMIT 100
  ) ids;
$function$;

REVOKE ALL ON FUNCTION public.worker_public_trust(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_public_trust(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.worker_public_trust(uuid[]) IS
  '#214. Antecedentes aprobados y oficios con matrícula verificada. Sin número, entidad, fotos ni legado sin_vincular.';
