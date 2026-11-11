-- #214 r3. Perfil público con la misma regla de sellos que fetch_feed_posts.
--
-- Cuerpo vivo de get_public_worker_profile(uuid) el 2026-11-11.
-- Único cambio: matriculas_verificadas, códigos de oficio con sello
-- (_matriculas_oficios_verificados: matrícula aprobada y al menos una foto
-- aprobada de la versión vigente, solo gas, electricidad, plomería y fumigación).
-- matricula_verificada queda en true solo si ese array no está vacío.
-- Antes llamaba a _matricula_publica_verificada, que también cuenta el legado
-- sin_vincular. El feed no lo muestra y el perfil tampoco.
--
-- No se abre ninguna función nueva. anon ya podía ejecutar esta.
-- No se le da EXECUTE a anon sobre ninguna otra función.

CREATE OR REPLACE FUNCTION public.get_public_worker_profile(p_worker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean;
  v_profile jsonb;
  v_trades jsonb;
  v_reviews jsonb;
  v_oficios text[];
BEGIN
  IF p_worker_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_worker_id
      AND p.professional_status = 'accepted'
      AND p.coverage_km IS NOT NULL
      AND p.coverage_km > 0
      AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
  ) INTO v_ok;

  IF NOT v_ok THEN
    RETURN NULL;
  END IF;

  v_oficios := public._matriculas_oficios_verificados(p_worker_id);

  SELECT jsonb_build_object(
    'id', p.id,
    'nombre', coalesce(NULLIF(trim(split_part(coalesce(p.nombre, ''), ' ', 1)), ''), 'Profesional'),
    'oficio', coalesce(
      (
        SELECT j2.nombre_oficio FROM public.jobs j2
        WHERE j2.user_id = p.id
        ORDER BY j2.es_principal DESC NULLS LAST, j2.created_at
        LIMIT 1
      ),
      'Servicios'
    ),
    'rating', coalesce(p.rating_average, 0),
    'resenas_count', coalesce(p.review_count, 0),
    'total_jobs_done', coalesce(p.total_jobs_done, 0),
    'avatar', NULLIF(trim(coalesce(p.avatar_url, '')), ''),
    'zona', NULLIF(trim(regexp_replace(coalesce(p.direccion_texto, ''), '^[^,]*,\s*', '')), ''),
    'descripcion', coalesce(NULLIF(trim(coalesce(p.professional_description, '')), ''), ''),
    'antecedentes_penales', EXISTS (
      SELECT 1
      FROM public.antecedentes_penales ap
      WHERE ap.user_id = p.id
        AND ap.status = 'aprobado'
    ),
    'matricula_verificada', coalesce(cardinality(v_oficios), 0) > 0,
    'matriculas_verificadas', coalesce(v_oficios, '{}'::text[])
  )
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_worker_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nombre', j.nombre_oficio,
        'descripcion', coalesce(j.descripcion, ''),
        'anos_experiencia', j.years_experience,
        'es_principal', coalesce(j.es_principal, false)
      )
      ORDER BY j.es_principal DESC NULLS LAST, j.created_at
    ),
    '[]'::jsonb
  )
  INTO v_trades
  FROM public.jobs j
  WHERE j.user_id = p_worker_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', wr.id,
        'rating', wr.rating,
        'comentario', coalesce(wr.comment, ''),
        'fecha', wr.created_at,
        'cliente', coalesce(
          NULLIF(trim(split_part(coalesce(cp.nombre, ''), ' ', 1)), ''),
          'Cliente'
        )
      )
      ORDER BY wr.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_reviews
  FROM (
    SELECT r.id, r.rating, r.comment, r.created_at, r.client_id
    FROM public.worker_reviews r
    WHERE r.worker_id = p_worker_id
    ORDER BY r.created_at DESC
    LIMIT 40
  ) wr
  LEFT JOIN public.profiles cp ON cp.id = wr.client_id;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'habilidades', coalesce(v_trades, '[]'::jsonb),
    'resenas', coalesce(v_reviews, '[]'::jsonb)
  );
END;
$function$;

-- CREATE OR REPLACE conserva los grants. Se reafirman los que ya estaban:
-- anon, authenticated y service_role. PUBLIC sigue sin EXECUTE.
REVOKE ALL ON FUNCTION public.get_public_worker_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_worker_profile(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_worker_profile(uuid) IS
  '#214. Perfil público. matriculas_verificadas son solo códigos de oficio con sello, la misma regla que el feed. matricula_verificada es true solo si ese array no está vacío. El legado sin_vincular no es un sello. No incluye fotos ni datos de la credencial.';
