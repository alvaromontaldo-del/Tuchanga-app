-- `profiles.bio` era la presentación vieja del cliente. La descripción del
-- profesional vive en professional_description. Si la descripción está vacía
-- y bio tiene texto, se copia antes de borrar la columna. Una descripción ya
-- cargada no se pisa (el editor es la fuente).

UPDATE public.profiles
SET
  professional_description = btrim(bio),
  updated_at = now()
WHERE btrim(coalesce(professional_description, '')) = ''
  AND btrim(coalesce(bio, '')) <> '';

-- El argumento sigue llamándose p_bio para no romper clientes que ya lo mandan.
-- El texto se guarda solo en professional_description.
CREATE OR REPLACE FUNCTION public.insert_profile_with_location(
  p_nombre text,
  p_apellido text,
  p_dni text,
  p_telefono text,
  p_direccion text,
  p_lat double precision,
  p_lng double precision,
  p_avatar_url text,
  p_coverage_km integer,
  p_bio text DEFAULT ''::text,
  p_document_type text DEFAULT 'dni'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_doc text := lower(trim(coalesce(p_document_type, 'dni')));
  v_dni text := regexp_replace(trim(coalesce(p_dni, '')), '[^0-9]', '', 'g');
  v_text text := trim(coalesce(p_bio, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_doc NOT IN ('dni', 'cuit') THEN
    RAISE EXCEPTION 'document_type inválido';
  END IF;

  IF v_dni = '' THEN
    RAISE EXCEPTION 'documento vacío';
  END IF;

  IF char_length(v_text) > 2000 THEN
    RAISE EXCEPTION 'professional_description_too_long';
  END IF;

  INSERT INTO public.profiles (
    id,
    nombre,
    apellido,
    dni,
    document_type,
    telefono,
    direccion_texto,
    location,
    avatar_url,
    coverage_km,
    professional_description
  )
  VALUES (
    v_uid,
    trim(p_nombre),
    trim(p_apellido),
    v_dni,
    v_doc,
    trim(p_telefono),
    trim(p_direccion),
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    NULLIF(trim(p_avatar_url), ''),
    p_coverage_km,
    v_text
  )
  ON CONFLICT (id) DO UPDATE
  SET
    nombre = EXCLUDED.nombre,
    apellido = EXCLUDED.apellido,
    dni = EXCLUDED.dni,
    document_type = EXCLUDED.document_type,
    telefono = EXCLUDED.telefono,
    direccion_texto = EXCLUDED.direccion_texto,
    location = EXCLUDED.location,
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    coverage_km = EXCLUDED.coverage_km,
    professional_description = CASE
      WHEN EXCLUDED.professional_description <> '' THEN EXCLUDED.professional_description
      ELSE profiles.professional_description
    END,
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_profile_registration(
  p_nombre text,
  p_apellido text,
  p_dni text,
  p_telefono text,
  p_direccion text,
  p_lat double precision,
  p_lng double precision,
  p_avatar_url text,
  p_bio text DEFAULT ''::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_text text := trim(coalesce(p_bio, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    nombre = trim(p_nombre),
    apellido = trim(p_apellido),
    dni = trim(p_dni),
    telefono = trim(p_telefono),
    direccion_texto = trim(p_direccion),
    location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    avatar_url = NULLIF(trim(p_avatar_url), ''),
    professional_description = CASE
      WHEN v_text <> '' THEN v_text
      ELSE professional_description
    END,
    updated_at = now()
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_professional_description(p_description text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_desc text := trim(coalesce(p_description, ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF char_length(v_desc) > 500 THEN
    RAISE EXCEPTION 'professional_description_too_long';
  END IF;

  UPDATE public.profiles
  SET
    professional_description = v_desc,
    updated_at = now()
  WHERE id = uid;
END;
$function$;

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
    'descripcion', coalesce(NULLIF(trim(coalesce(p.professional_description, '')), ''), '')
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

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_bio_len_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bio;
