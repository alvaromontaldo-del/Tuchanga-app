-- Alta profesional: la descripción quedaba solo en bio (insert_profile_with_location)
-- y Editar perfil lee professional_description. El RPC update_professional_description
-- ya escribe las dos columnas (SECURITY DEFINER). Este cambio hace que el INSERT
-- del alta también deje el mismo texto en professional_description.
-- Una bio vacía no pisa una descripción que ya estaba.
-- CREATE OR REPLACE conserva el GRANT existente (authenticated, service_role).

CREATE OR REPLACE FUNCTION public.insert_profile_with_location(p_nombre text, p_apellido text, p_dni text, p_telefono text, p_direccion text, p_lat double precision, p_lng double precision, p_avatar_url text, p_coverage_km integer, p_bio text DEFAULT ''::text, p_document_type text DEFAULT 'dni'::text)
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
    bio,
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
    v_text,
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
    bio = CASE
      WHEN EXCLUDED.bio <> '' THEN EXCLUDED.bio
      ELSE profiles.bio
    END,
    professional_description = CASE
      WHEN EXCLUDED.professional_description <> '' THEN EXCLUDED.professional_description
      ELSE profiles.professional_description
    END,
    updated_at = now();
END;
$function$;

-- Por si el GRANT de columnas no está: el alta igual puede guardar por RPC.
GRANT UPDATE (professional_description, bio) ON public.profiles TO authenticated;
