-- Tarjeta #109: Registro de cliente puede fallar con bio vacía.
-- Proyecto: TuChangaAPP (kyxehrxcdealbujvvnxp). Aplicado en producción el 2026-10-01.
--
-- Problema: insert_profile_with_location convertía una bio vacía en NULL
-- (NULLIF(trim(coalesce(p_bio, '')), '')), pero profiles.bio es NOT NULL
-- (default ''). Un cliente que se registraba sin bio recibía el error 23502, y
-- el reintento de la app (sin p_bio, que por defecto vale '') fallaba igual.
--
-- Arreglo mínimo, rehecho desde la definición de producción (pg_get_functiondef):
--   * INSERT: bio guarda trim(coalesce(p_bio, '')), es decir '' cuando viene vacía o NULL.
--   * ON CONFLICT: bio = COALESCE(NULLIF(EXCLUDED.bio, ''), profiles.bio). Igual que
--     antes, un reintento con bio vacía no borra la bio que ya estaba guardada.
-- Todo lo demás queda igual: validación de documento (dni/cuit, documento vacío),
-- ON CONFLICT (id) DO UPDATE, SECURITY DEFINER, search_path = public, firma y
-- defaults. CREATE OR REPLACE conserva owner y GRANT (anon, authenticated,
-- service_role), así que no se tocan.
--
-- Otras columnas NOT NULL del INSERT: solo bio se anulaba a propósito con NULLIF.
-- avatar_url también usa NULLIF, pero acepta NULL. nombre, apellido, telefono,
-- direccion_texto y location solo quedan NULL si la app manda NULL, y la app
-- siempre manda texto y coordenadas (lat/lng caen a 0), así que no se cambian.

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
    bio
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
    trim(coalesce(p_bio, ''))
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
    bio = COALESCE(NULLIF(EXCLUDED.bio, ''), profiles.bio),
    updated_at = now();
END;
$function$
;

-- Verificación (solo lectura): tiene que dar bio_fix = true y la misma ACL de antes.
SELECT position('trim(coalesce(p_bio, ''''))' IN pg_get_functiondef(p.oid)) > 0 AS bio_fix,
       p.prosecdef AS security_definer,
       p.proconfig,
       p.proacl::text AS grants
FROM pg_proc p
WHERE p.oid = 'public.insert_profile_with_location(text,text,text,text,text,double precision,double precision,text,integer,text,text)'::regprocedure;
