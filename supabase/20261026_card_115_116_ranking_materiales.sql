-- YaChanga #115 + #116. Ranking de profesionales y check de materiales por oficio.
-- NO está aplicado. No despliega nada. No toca rubros de comercio.
--
-- Producción (kyxehrxcdealbujvvnxp), leído el 2026-10-26 con pg_get_functiondef:
--   * search_workers_for_client(double precision, double precision, text, text[], uuid, integer)
--     md5 a421ef5c7e08c83f1b07e67a7addfa78.
--     Se recrea desde ese cuerpo. Misma firma y mismas columnas de salida.
--     El ranking_score se calcula adentro y solo ordena: no sale al cliente.
--     Orden fijo: score DESC, rating DESC, trabajos DESC, id. Sin distancia.
--     Los filtros, el radio, el redondeo de lat/lng y apellido NULL quedan iguales.
--     La función viva tenía EXECUTE para anon. Este script no se lo da: la búsqueda
--     de la app exige sesión. authenticated y service_role sí.
--   * search_workers_public no se toca. El score usa contrataciones y material_requests;
--     no es un ORDER BY trivial. Sigue el orden actual (anon conserva su grant).
--   * crear_cotizacion / editar_cotizacion / recotizar_en_curso no se tocan.
--     El check habilita la solicitud de cotización de materiales, no el presupuesto.
--
-- Decisiones de Alvaro (mandan sobre el brief):
--   * Un solo check, allows_materials_list, en professional_trades. Todos en true.
--   * El puntaje solo ordena y no se devuelve. La salida no lleva facturación.
--   * No hay selector de orden ni desempate por km.
--   * No entran km, matrícula ni antecedentes (siguen como booleanos de insignia).
--   * Inactividad = días desde el último trabajo finalizado y totalmente pagado
--     (ahí el trabajador facturó). Sin ese trabajo, factor 1.
--   * Sin trabajos (profiles.total_jobs_done = 0): ranking_score 0.5000, sin
--     penalizar por reseñas, facturación ni inactividad.
--
-- Ponderación (#115), con LN (el cociente no depende de la base):
--   allows true:  estrellas (rating/5)*0.35 + trabajos LEAST(1, LN(jobs+1)/LN(101))*0.25
--                 + facturación LEAST(1, LN(earned+1)/LN(1000001))*0.25
--                 + materiales LEAST(1, LN(sent+1)/LN(21))*0.15
--   allows false: estrellas *0.40 + trabajos *0.30 + facturación *0.30
--   days_inactive <= 30 → factor 1; si no, GREATEST(0.50, 1 - (days-30)*0.0033)
--   ranking_score = round(base * factor, 4)
--
-- Trabajos del término: profiles.total_jobs_done (el contador que la búsqueda ya
-- muestra). Facturación: sum(contrataciones.precio_trabajador) con
-- estado_pago = totalmente_pagado. No sale de la función.
-- Materiales: count(material_requests) del profesional con status <> 'draft'.
-- El check no tiene 'cancelled'; no hay nada más que excluir.
-- Oficio del flag: el filtro de rubro si hay uno (si hay varios, el principal
-- del profesional entre los elegidos); si el texto matchea un solo oficio del
-- catálogo, ese; si no, el oficio principal.

BEGIN;

DO $guard$
BEGIN
  IF md5(pg_get_functiondef(
    'public.search_workers_for_client(double precision,double precision,text,text[],uuid,integer)'::regprocedure
  )) IS DISTINCT FROM 'a421ef5c7e08c83f1b07e67a7addfa78' THEN
    RAISE EXCEPTION
      'search_workers_for_client cambió en producción (md5 distinto de a421ef5c7e08c83f1b07e67a7addfa78). Volvé a copiar el cuerpo vivo antes de aplicar #115.';
  END IF;
END
$guard$;

ALTER TABLE public.professional_trades
  ADD COLUMN IF NOT EXISTS allows_materials_list boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.professional_trades.allows_materials_list IS
  'Oficio de profesional: habilita pedir cotización de materiales a comercios. Los rubros de comercio no usan esta columna. Default true.';

CREATE OR REPLACE FUNCTION public.trade_allows_materials_list(p_trade_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_trade_name IS NULL OR btrim(p_trade_name) = '' THEN true
    ELSE coalesce((
      SELECT pt.allows_materials_list
      FROM public.professional_trades pt
      WHERE pt.active
        AND public.search_fold(pt.name) = public.search_fold(p_trade_name)
      LIMIT 1
    ), true)
  END;
$function$;

COMMENT ON FUNCTION public.trade_allows_materials_list(text) IS
  'True si el oficio profesional puede pedir lista de materiales. Sin nombre o fuera de catálogo: true.';

REVOKE ALL ON FUNCTION public.trade_allows_materials_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trade_allows_materials_list(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.trade_allows_materials_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trade_allows_materials_list(text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_trade_allows_materials_list(
  p_trade_id uuid,
  p_allows boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_trade_id IS NULL OR p_allows IS NULL THEN
    RAISE EXCEPTION 'Faltan datos del oficio';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  UPDATE public.professional_trades
     SET allows_materials_list = p_allows,
         updated_at = now()
   WHERE id = p_trade_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficio no encontrado';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.admin_set_trade_allows_materials_list(uuid, boolean) IS
  'Admin: prende o apaga la solicitud de materiales de un oficio profesional.';

REVOKE ALL ON FUNCTION public.admin_set_trade_allows_materials_list(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_trade_allows_materials_list(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_trade_allows_materials_list(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_trade_allows_materials_list(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.material_requests_guard_trade_materials_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_trade text;
  v_allows boolean;
BEGIN
  -- Las solicitudes ya enviadas siguen su curso. Solo se frena un alta nueva
  -- o el paso de borrador a enviado.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM 'draft' OR NEW.status = 'draft' THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  v_trade := NULL;
  IF NEW.conversation_id IS NOT NULL THEN
    SELECT NULLIF(btrim(c.primary_trade), '')
      INTO v_trade
      FROM public.conversations c
     WHERE c.id = NEW.conversation_id;
  END IF;

  IF v_trade IS NULL AND NEW.professional_id IS NOT NULL THEN
    SELECT NULLIF(btrim(j.nombre_oficio), '')
      INTO v_trade
      FROM public.jobs j
     WHERE j.user_id = NEW.professional_id
     ORDER BY j.es_principal DESC, j.nombre_oficio
     LIMIT 1;
  END IF;

  v_allows := public.trade_allows_materials_list(v_trade);
  IF NOT coalesce(v_allows, true) THEN
    RAISE EXCEPTION 'Este oficio no puede pedir cotización de materiales'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.material_requests_guard_trade_materials_list() IS
  'Rechaza una solicitud de materiales nueva si el oficio del chat no la permite.';

REVOKE ALL ON FUNCTION public.material_requests_guard_trade_materials_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.material_requests_guard_trade_materials_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.material_requests_guard_trade_materials_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_requests_guard_trade_materials_list() TO service_role;

DROP TRIGGER IF EXISTS trg_material_requests_trade_materials_list ON public.material_requests;
CREATE TRIGGER trg_material_requests_trade_materials_list
  BEFORE INSERT OR UPDATE OF status
  ON public.material_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.material_requests_guard_trade_materials_list();

DROP FUNCTION IF EXISTS public.search_workers_for_client(
  double precision, double precision, text, text[], uuid, integer
);

CREATE FUNCTION public.search_workers_for_client(
  p_client_lat double precision,
  p_client_lng double precision,
  p_query text DEFAULT ''::text,
  p_category_names text[] DEFAULT NULL::text[],
  p_exclude_user_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 80
)
RETURNS TABLE(
  profile_id uuid,
  nombre text,
  apellido text,
  avatar_url text,
  lat double precision,
  lng double precision,
  coverage_km integer,
  distance_km double precision,
  primary_trade text,
  all_trades text[],
  summary_jobs text,
  rating_average numeric,
  review_count integer,
  total_jobs_done integer,
  atiende_urgencias boolean,
  antecedentes_penales boolean,
  matricula_verificada boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH client_pt AS (
    SELECT st_setsrid(st_makepoint(p_client_lng, p_client_lat), 4326)::geography AS g
  ),
  lim AS (
    SELECT least(greatest(coalesce(p_limit, 80), 1), 100) AS n
  ),
  query_trades AS (
    SELECT public.trade_names_for_query(coalesce(p_query, '')) AS names
  ),
  paid AS (
    SELECT
      c.worker_id,
      coalesce(sum(c.precio_trabajador), 0)::numeric AS earned,
      max(c.finalizado_at) FILTER (
        WHERE c.estado_trabajo = 'finalizado'
          AND c.finalizado_at IS NOT NULL
      ) AS last_invoiced_close_at
    FROM public.contrataciones c
    WHERE c.estado_pago = 'totalmente_pagado'
    GROUP BY c.worker_id
  ),
  mats AS (
    SELECT
      mr.professional_id,
      count(*)::integer AS sent
    FROM public.material_requests mr
    WHERE mr.professional_id IS NOT NULL
      AND mr.status <> 'draft'
    GROUP BY mr.professional_id
  ),
  base AS (
    SELECT
      p.id AS profile_id,
      p.nombre,
      p.avatar_url,
      st_y(p.location::geometry) AS lat_exact,
      st_x(p.location::geometry) AS lng_exact,
      p.coverage_km,
      st_distance(p.location, (SELECT g FROM client_pt), false) / 1000.0 AS distance_exact,
      (
        SELECT j2.nombre_oficio
        FROM public.jobs j2
        WHERE j2.user_id = p.id
        ORDER BY j2.es_principal DESC, j2.nombre_oficio
        LIMIT 1
      ) AS primary_trade,
      (
        SELECT array_agg(j3.nombre_oficio ORDER BY j3.es_principal DESC, j3.nombre_oficio)
        FROM public.jobs j3
        WHERE j3.user_id = p.id
      ) AS all_trades,
      (
        SELECT string_agg(j4.nombre_oficio || ': ' || coalesce(j4.descripcion, ''), ' · ')
        FROM public.jobs j4
        WHERE j4.user_id = p.id
      ) AS summary_jobs,
      coalesce(p.rating_average, 0) AS rating_average,
      coalesce(p.review_count, 0) AS review_count,
      coalesce(p.total_jobs_done, 0) AS total_jobs_done,
      p.atiende_urgencias,
      EXISTS (
        SELECT 1
        FROM public.antecedentes_penales ap
        WHERE ap.user_id = p.id
          AND ap.status = 'aprobado'
      ) AS antecedentes_penales,
      EXISTS (
        SELECT 1
        FROM public.matriculas mv
        WHERE mv.user_id = p.id
          AND mv.status = 'aprobada'
      ) AS matricula_verificada
    FROM public.profiles p
    WHERE p.professional_status = 'accepted'
      AND p.location IS NOT NULL
      AND p.coverage_km IS NOT NULL
      AND p.coverage_km > 0
      AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
      AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
  ),
  filtered AS (
    SELECT b.*
    FROM base b
    WHERE b.distance_exact <= b.coverage_km
      AND (
        coalesce(trim(p_query), '') = ''
        OR b.nombre ILIKE '%' || trim(p_query) || '%'
        OR b.primary_trade ILIKE '%' || trim(p_query) || '%'
        OR exists (
          SELECT 1 FROM unnest(coalesce(b.all_trades, array[]::text[])) t
          WHERE t ILIKE '%' || trim(p_query) || '%'
        )
        OR coalesce(b.summary_jobs, '') ILIKE '%' || trim(p_query) || '%'
        -- #97: palabras clave del oficio
        OR exists (
          SELECT 1 FROM unnest(coalesce(b.all_trades, array[]::text[])) t
          WHERE public.search_fold(t) = ANY ((SELECT public.trade_names_for_query(p_query))::text[])
        )
      )
      AND (
        p_category_names IS NULL
        OR cardinality(p_category_names) = 0
        OR exists (
          SELECT 1
          FROM unnest(coalesce(b.all_trades, array[]::text[])) t
          WHERE t = ANY (p_category_names)
        )
      )
  ),
  scored AS (
    SELECT
      m.profile_id,
      m.nombre,
      m.avatar_url,
      m.lat_exact,
      m.lng_exact,
      m.coverage_km,
      m.distance_exact,
      m.primary_trade,
      m.all_trades,
      m.summary_jobs,
      m.rating_average,
      m.review_count,
      m.total_jobs_done,
      m.atiende_urgencias,
      m.antecedentes_penales,
      m.matricula_verificada,
      CASE
        WHEN m.total_jobs_done <= 0 THEN 0.5000
        ELSE round((m.score_base * m.activity_factor)::numeric, 4)
      END AS ranking_score
    FROM (
      SELECT
        f.*,
        CASE
          WHEN flag.allows THEN
            (least(greatest(f.rating_average, 0), 5) / 5.0) * 0.35
            + least(1.0, ln((f.total_jobs_done + 1)::numeric) / ln(101::numeric)) * 0.25
            + least(1.0, ln((coalesce(paid.earned, 0) + 1)::numeric) / ln(1000001::numeric)) * 0.25
            + least(1.0, ln((coalesce(mats.sent, 0) + 1)::numeric) / ln(21::numeric)) * 0.15
          ELSE
            (least(greatest(f.rating_average, 0), 5) / 5.0) * 0.40
            + least(1.0, ln((f.total_jobs_done + 1)::numeric) / ln(101::numeric)) * 0.30
            + least(1.0, ln((coalesce(paid.earned, 0) + 1)::numeric) / ln(1000001::numeric)) * 0.30
        END AS score_base,
        CASE
          WHEN f.total_jobs_done <= 0 OR paid.last_invoiced_close_at IS NULL THEN 1.0
          WHEN greatest(
            0,
            floor(extract(epoch FROM (now() - paid.last_invoiced_close_at)) / 86400)
          )::numeric <= 30 THEN 1.0
          ELSE greatest(
            0.50,
            1.0 - (
              (
                greatest(
                  0,
                  floor(extract(epoch FROM (now() - paid.last_invoiced_close_at)) / 86400)
                )::numeric - 30
              ) * 0.0033
            )
          )
        END AS activity_factor
      FROM filtered f
      LEFT JOIN paid ON paid.worker_id = f.profile_id
      LEFT JOIN mats ON mats.professional_id = f.profile_id
      LEFT JOIN LATERAL (
        SELECT public.trade_allows_materials_list(
          CASE
            WHEN p_category_names IS NOT NULL AND cardinality(p_category_names) = 1
              THEN p_category_names[1]
            WHEN p_category_names IS NOT NULL AND cardinality(p_category_names) > 1
              THEN (
                SELECT u.t
                FROM unnest(coalesce(f.all_trades, array[]::text[])) AS u(t)
                WHERE u.t = ANY (p_category_names)
                ORDER BY (u.t = f.primary_trade) DESC, u.t
                LIMIT 1
              )
            WHEN cardinality(coalesce((SELECT qt.names FROM query_trades qt), array[]::text[])) = 1
              THEN (
                SELECT ptq.name
                FROM public.professional_trades ptq
                WHERE ptq.active
                  AND public.search_fold(ptq.name) = (SELECT qt.names[1] FROM query_trades qt)
                LIMIT 1
              )
            ELSE f.primary_trade
          END
        ) AS allows
      ) flag ON true
    ) m
  )
  -- salida al cliente: sin facturación y sin apellido
  SELECT
    s.profile_id,
    s.nombre,
    NULL::text AS apellido,
    s.avatar_url,
    round(s.lat_exact::numeric, 2)::double precision AS lat,
    round(s.lng_exact::numeric, 2)::double precision AS lng,
    s.coverage_km,
    round(s.distance_exact::numeric, 1)::double precision AS distance_km,
    s.primary_trade,
    s.all_trades,
    s.summary_jobs,
    s.rating_average,
    s.review_count,
    s.total_jobs_done,
    s.atiende_urgencias,
    s.antecedentes_penales,
    s.matricula_verificada
  FROM scored s
  -- orden fijo: score, estrellas, trabajos, id. Sin distancia.
  ORDER BY
    s.ranking_score DESC,
    s.rating_average DESC NULLS LAST,
    s.total_jobs_done DESC NULLS LAST,
    s.profile_id ASC
  LIMIT (SELECT n FROM lim);
$function$;

COMMENT ON FUNCTION public.search_workers_for_client(
  double precision, double precision, text, text[], uuid, integer
) IS
  'Búsqueda de profesionales ordenada por ranking interno. El score no se devuelve. apellido es NULL. No devuelve facturación.';

REVOKE ALL ON FUNCTION public.search_workers_for_client(
  double precision, double precision, text, text[], uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_workers_for_client(
  double precision, double precision, text, text[], uuid, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(
  double precision, double precision, text, text[], uuid, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(
  double precision, double precision, text, text[], uuid, integer
) TO service_role;

COMMIT;
