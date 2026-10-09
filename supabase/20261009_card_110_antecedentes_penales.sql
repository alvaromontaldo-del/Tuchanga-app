-- YaChanga #110. Certificado de antecedentes penales.
-- NO está aplicado. NO despliega la edge function. NO publica el bucket.
--
-- Producción (kyxehrxcdealbujvvnxp), leído el 2026-10-09:
--   * get_public_worker_profile(uuid) es el cuerpo vivo. Solo se agrega la
--     clave booleana antecedentes_penales. Sigue el nombre de pila
--     (split_part), la puerta accepted + coverage_km > 0 + oficios, y los
--     grants (anon, authenticated, service_role). No se agrega apellido,
--     DNI, mail ni la ruta del archivo.
--   * storage_referenced_paths() es el cuerpo vivo. Solo se agrega el UNION
--     del bucket privado, para que la purga de huérfanos no borre el
--     certificado vigente. Grants iguales: postgres y service_role.
--   * is_admin() y _admin_require() no se reemplazan. Las RPC de admin
--     llaman a las dos.
--   * El push de rechazo NO usa invoke_vault_edge_webhook (ese helper de #65
--     puede no estar aplicado y su lista de slugs es cerrada). Esta función
--     propia lee vault.decrypted_secrets name = edge_function_secret en el
--     momento del POST y no guarda el secreto en la definición.
--
-- Orden cuando lo corra el coordinador:
--   1. Este SQL.
--   2. Deploy de push_on_antecedentes con verify_jwt = false
--      (autentica con x-function-secret, igual que los otros push).
--   3. La app. Sin el SQL, la pantalla avisa que la carga no está habilitada.
--
-- La URL firmada la arma admin_list_antecedentes_pendientes con el JWT del
-- admin (header de la request) contra Storage. Dura 10 minutos. Si el header
-- no está (SQL editor), archivo_url vuelve null y queda storage_path: el
-- panel firma con createSignedUrl. La policy SELECT deja pasar solo al
-- dueño y a is_admin(). El bucket es privado: no se arma una URL pública.

BEGIN;

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.antecedentes_penales (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles (id),
  CONSTRAINT antecedentes_penales_status_chk
    CHECK (status IN ('pendiente', 'aprobado', 'rechazado')),
  CONSTRAINT antecedentes_penales_mime_chk
    CHECK (mime_type IN ('image/jpeg', 'application/pdf')),
  CONSTRAINT antecedentes_penales_rechazo_chk
    CHECK (
      status <> 'rechazado'
      OR (
        rejection_reason IS NOT NULL
        AND btrim(rejection_reason) <> ''
        AND char_length(rejection_reason) <= 300
      )
    )
);

COMMENT ON TABLE public.antecedentes_penales IS
  '#110. Un certificado por profesional. El archivo vive en el bucket privado antecedentes-penales. El perfil público solo ve el booleano aprobado.';

COMMENT ON COLUMN public.antecedentes_penales.rejection_reason IS
  '#110. Asunto que escribió el admin al rechazar. Viaja en el push y se muestra en la app.';

COMMENT ON COLUMN public.antecedentes_penales.reviewed_by IS
  '#110. Admin que aprobó o rechazó (auth.uid()).';

CREATE INDEX IF NOT EXISTS antecedentes_penales_pendientes_idx
  ON public.antecedentes_penales (updated_at)
  WHERE status = 'pendiente';

ALTER TABLE public.antecedentes_penales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS antecedentes_penales_select_own ON public.antecedentes_penales;
CREATE POLICY antecedentes_penales_select_own
  ON public.antecedentes_penales
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.antecedentes_penales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.antecedentes_penales TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'antecedentes-penales',
  'antecedentes-penales',
  false,
  2097152,
  ARRAY['image/jpeg', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS antecedentes_penales_insert_own ON storage.objects;
CREATE POLICY antecedentes_penales_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'antecedentes-penales'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND coalesce(array_length(storage.foldername(name), 1), 0) = 1
    AND name ~ '\.(jpg|pdf)$'
  );

DROP POLICY IF EXISTS antecedentes_penales_select_own ON storage.objects;
CREATE POLICY antecedentes_penales_select_own
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'antecedentes-penales'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS antecedentes_penales_select_admin ON storage.objects;
CREATE POLICY antecedentes_penales_select_admin
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'antecedentes-penales'
    AND public.is_admin()
  );

DROP POLICY IF EXISTS antecedentes_penales_delete_own ON storage.objects;
CREATE POLICY antecedentes_penales_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'antecedentes-penales'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Firma un objeto del bucket privado. Solo la llama el listado admin.
-- No acepta una URL arbitraria: el host y el bucket están fijos.
CREATE OR REPLACE FUNCTION public.antecedentes_admin_signed_url(p_path text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_headers jsonb := '{}'::jsonb;
  v_raw text;
  v_auth text;
  v_apikey text;
  v_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5eGVocnhjZGVhbGJ1anZ2bnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Nzk2OTEsImV4cCI6MjA5MTI1NTY5MX0.Ef5iZCbrseW4TYxSScOiqpAP8lZrjaQi2OItzCU5W9Y';
  v_status integer;
  v_content text;
  v_json jsonb;
  v_rel text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF p_path IS NULL OR p_path !~ '^[0-9a-f-]{36}/[0-9]{13}-[a-z0-9]{6,12}\.(jpg|pdf)$' THEN
    RETURN NULL;
  END IF;

  v_raw := current_setting('request.headers', true);
  IF v_raw IS NOT NULL AND left(btrim(v_raw), 1) = '{' THEN
    v_headers := v_raw::jsonb;
  END IF;

  v_auth := coalesce(v_headers->>'authorization', v_headers->>'Authorization', '');
  v_apikey := coalesce(nullif(v_headers->>'apikey', ''), nullif(v_headers->>'Apikey', ''), v_anon);

  IF btrim(v_auth) = '' THEN
    RETURN NULL;
  END IF;

  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '8');

  SELECT r.status, r.content
    INTO v_status, v_content
  FROM extensions.http((
    'POST'::extensions.http_method,
    'https://kyxehrxcdealbujvvnxp.supabase.co/storage/v1/object/sign/antecedentes-penales/' || p_path,
    ARRAY[
      extensions.http_header('Authorization', v_auth),
      extensions.http_header('apikey', v_apikey),
      extensions.http_header('Content-Type', 'application/json')
    ]::extensions.http_header[],
    'application/json',
    '{"expiresIn":600}'
  )::extensions.http_request) AS r;

  IF v_status IS NULL OR v_status < 200 OR v_status >= 300 OR v_content IS NULL THEN
    RETURN NULL;
  END IF;

  v_json := v_content::jsonb;
  v_rel := coalesce(v_json->>'signedURL', v_json->>'signedUrl', '');
  IF v_rel = '' THEN
    RETURN NULL;
  END IF;
  IF v_rel LIKE 'https://%' THEN
    RETURN v_rel;
  END IF;
  IF left(v_rel, 1) = '/' THEN
    RETURN 'https://kyxehrxcdealbujvvnxp.supabase.co/storage/v1' || v_rel;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'antecedentes_admin_signed_url: %', SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.antecedentes_admin_signed_url(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.antecedentes_admin_signed_url(text) TO service_role;

COMMENT ON FUNCTION public.antecedentes_admin_signed_url(text) IS
  '#110. URL firmada de 10 minutos. Solo is_admin(). Sin JWT de request devuelve null. No es pública.';

CREATE OR REPLACE FUNCTION public.notify_antecedentes_rechazo(
  p_user_id uuid,
  p_asunto text,
  p_event_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  v_anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5eGVocnhjZGVhbGJ1anZ2bnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Nzk2OTEsImV4cCI6MjA5MTI1NTY5MX0.Ef5iZCbrseW4TYxSScOiqpAP8lZrjaQi2OItzCU5W9Y';
  v_headers jsonb;
  v_payload jsonb;
BEGIN
  IF p_user_id IS NULL OR btrim(coalesce(p_asunto, '')) = '' THEN
    RETURN;
  END IF;

  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'edge_function_secret'
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'notify_antecedentes_rechazo: falta vault edge_function_secret';
    RETURN;
  END IF;

  v_headers := jsonb_build_object(
    'apikey', v_anon,
    'Content-type', 'application/json',
    'Authorization', 'Bearer ' || v_anon,
    'x-function-secret', btrim(v_secret)
  );

  v_payload := jsonb_build_object(
    'type', 'UPDATE',
    'table', 'antecedentes_penales',
    'schema', 'public',
    'record', jsonb_build_object(
      'user_id', p_user_id,
      'asunto', btrim(p_asunto),
      'event_key', left(coalesce(p_event_key, ''), 240)
    ),
    'old_record', NULL
  );

  PERFORM net.http_post(
    'https://kyxehrxcdealbujvvnxp.supabase.co/functions/v1/push_on_antecedentes',
    v_payload,
    '{}'::jsonb,
    v_headers,
    5000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_antecedentes_rechazo: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) IS
  '#110. Push al profesional con el asunto del rechazo. Secreto leído de Vault (edge_function_secret), como #65. Sin EXECUTE para anon ni authenticated.';

CREATE OR REPLACE FUNCTION public.get_my_antecedentes_penales()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT jsonb_build_object(
    'status', a.status,
    'asunto', CASE WHEN a.status = 'rechazado' THEN a.rejection_reason ELSE NULL END,
    'mime_type', a.mime_type,
    'updated_at', a.updated_at
  )
    INTO v_row
  FROM public.antecedentes_penales a
  WHERE a.user_id = v_uid;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_antecedentes_penales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_antecedentes_penales() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_antecedentes_penales() IS
  '#110. Estado del certificado del profesional logueado. No devuelve la ruta ni una URL.';

CREATE OR REPLACE FUNCTION public.submit_my_antecedentes_penales(
  p_storage_path text,
  p_mime_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_old text;
  v_meta jsonb;
  v_size bigint;
  v_updated timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_path !~ ('^' || v_uid::text || '/[0-9]{13}-[a-z0-9]{6,12}\.(jpg|pdf)$') THEN
    RAISE EXCEPTION 'El archivo no corresponde a tu cuenta.';
  END IF;

  IF v_mime NOT IN ('image/jpeg', 'application/pdf') THEN
    RAISE EXCEPTION 'Solo se acepta una foto JPEG o un PDF.';
  END IF;

  IF v_path LIKE '%.pdf' AND v_mime <> 'application/pdf' THEN
    RAISE EXCEPTION 'El PDF no coincide con el tipo de archivo.';
  END IF;
  IF v_path LIKE '%.jpg' AND v_mime <> 'image/jpeg' THEN
    RAISE EXCEPTION 'La foto no coincide con el tipo de archivo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid) THEN
    RAISE EXCEPTION 'No encontramos tu perfil.';
  END IF;

  SELECT o.metadata
    INTO v_meta
  FROM storage.objects o
  WHERE o.bucket_id = 'antecedentes-penales'
    AND o.name = v_path;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos el archivo. Volvé a cargarlo.';
  END IF;

  v_size := coalesce((v_meta->>'size')::bigint, 0);
  IF v_size > 2097152 THEN
    RAISE EXCEPTION 'El archivo supera 2 MB.';
  END IF;

  SELECT a.storage_path
    INTO v_old
  FROM public.antecedentes_penales a
  WHERE a.user_id = v_uid;

  IF v_old IS NOT NULL AND v_old <> v_path THEN
    BEGIN
      DELETE FROM storage.objects o
      WHERE o.bucket_id = 'antecedentes-penales'
        AND o.name = v_old;
    EXCEPTION WHEN OTHERS THEN
      -- La app también borra previous_path. El reenvío no puede quedar trabado.
      RAISE WARNING 'antecedentes borrar anterior: %', SQLERRM;
    END;
  END IF;

  INSERT INTO public.antecedentes_penales (
    user_id, status, storage_path, mime_type, rejection_reason, reviewed_at, reviewed_by, updated_at
  ) VALUES (
    v_uid, 'pendiente', v_path, v_mime, NULL, NULL, NULL, now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET status = 'pendiente',
      storage_path = EXCLUDED.storage_path,
      mime_type = EXCLUDED.mime_type,
      rejection_reason = NULL,
      reviewed_at = NULL,
      reviewed_by = NULL,
      updated_at = now()
  RETURNING updated_at INTO v_updated;

  RETURN jsonb_build_object(
    'status', 'pendiente',
    'asunto', NULL,
    'updated_at', v_updated,
    'previous_path', CASE WHEN v_old IS NOT NULL AND v_old <> v_path THEN v_old ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_my_antecedentes_penales(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_my_antecedentes_penales(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_my_antecedentes_penales(text, text) IS
  '#110. El profesional registra su archivo y queda en pendiente. Borra el archivo anterior. No puede aprobarse solo.';

CREATE OR REPLACE FUNCTION public.admin_list_antecedentes_pendientes()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'updated_at'), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'user_id', a.user_id,
      'nombre', coalesce(nullif(btrim(p.nombre), ''), ''),
      'apellido', coalesce(nullif(btrim(p.apellido), ''), ''),
      'oficio', coalesce((
        SELECT j.nombre_oficio
        FROM public.jobs j
        WHERE j.user_id = a.user_id
        ORDER BY j.es_principal DESC NULLS LAST, j.created_at
        LIMIT 1
      ), ''),
      'dni', coalesce(nullif(btrim(p.dni), ''), ''),
      'email', coalesce(u.email, ''),
      'mime_type', a.mime_type,
      'storage_bucket', 'antecedentes-penales',
      'storage_path', a.storage_path,
      'archivo_url', public.antecedentes_admin_signed_url(a.storage_path),
      'archivo_url_expira_en_segundos', 600,
      'updated_at', a.updated_at
    ) AS item
    FROM public.antecedentes_penales a
    JOIN public.profiles p ON p.id = a.user_id
    LEFT JOIN auth.users u ON u.id = a.user_id
    WHERE a.status = 'pendiente'
  ) q;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_antecedentes_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_antecedentes_pendientes() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_antecedentes_pendientes() IS
  '#110. Pendientes para el admin: nombre, apellido, oficio, DNI, mail, ruta y URL firmada (10 min). archivo_url es null si la request no trae Authorization: en ese caso usar storage_path con createSignedUrl. Nunca una URL pública.';

CREATE OR REPLACE FUNCTION public.admin_aprobar_antecedentes_penales(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_status text;
  v_at timestamptz := now();
BEGIN
  v_admin := public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario.';
  END IF;

  SELECT a.status
    INTO v_status
  FROM public.antecedentes_penales a
  WHERE a.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un certificado para este usuario.';
  END IF;

  IF v_status IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'No hay un certificado pendiente para este usuario.';
  END IF;

  UPDATE public.antecedentes_penales
  SET status = 'aprobado',
      rejection_reason = NULL,
      reviewed_at = v_at,
      reviewed_by = v_admin,
      updated_at = v_at
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status', 'aprobado',
    'reviewed_at', v_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_aprobar_antecedentes_penales(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_aprobar_antecedentes_penales(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_aprobar_antecedentes_penales(uuid) IS
  '#110. Pasa un pendiente a aprobado. El perfil público muestra el tilde. No devuelve el archivo.';

CREATE OR REPLACE FUNCTION public.admin_rechazar_antecedentes_penales(
  p_user_id uuid,
  p_asunto text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_status text;
  v_asunto text := btrim(coalesce(p_asunto, ''));
  v_at timestamptz := now();
  v_event text;
BEGIN
  v_admin := public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario.';
  END IF;

  IF v_asunto = '' THEN
    RAISE EXCEPTION 'Tenés que indicar el asunto del rechazo.';
  END IF;

  IF char_length(v_asunto) > 300 THEN
    RAISE EXCEPTION 'El asunto puede tener hasta 300 caracteres.';
  END IF;

  SELECT a.status
    INTO v_status
  FROM public.antecedentes_penales a
  WHERE a.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un certificado para este usuario.';
  END IF;

  IF v_status IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'No hay un certificado pendiente para este usuario.';
  END IF;

  UPDATE public.antecedentes_penales
  SET status = 'rechazado',
      rejection_reason = v_asunto,
      reviewed_at = v_at,
      reviewed_by = v_admin,
      updated_at = v_at
  WHERE user_id = p_user_id;

  v_event := 'antecedentes:' || p_user_id::text || ':' || floor(extract(epoch FROM v_at))::text;
  PERFORM public.notify_antecedentes_rechazo(p_user_id, v_asunto, v_event);

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status', 'rechazado',
    'asunto', v_asunto,
    'reviewed_at', v_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_rechazar_antecedentes_penales(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rechazar_antecedentes_penales(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_rechazar_antecedentes_penales(uuid, text) IS
  '#110. Rechaza un pendiente con asunto, lo guarda para la app y dispara el push. El secreto sale de Vault.';

CREATE OR REPLACE FUNCTION public.list_public_antecedentes_aprobados(p_worker_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(p.id), '{}'::uuid[])
  FROM public.profiles p
  WHERE p.id = ANY (coalesce(p_worker_ids, '{}'::uuid[])[1:80])
    AND p.professional_status = 'accepted'
    AND p.coverage_km IS NOT NULL
    AND p.coverage_km > 0
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
    AND EXISTS (
      SELECT 1
      FROM public.antecedentes_penales a
      WHERE a.user_id = p.id
        AND a.status = 'aprobado'
    );
$function$;

REVOKE ALL ON FUNCTION public.list_public_antecedentes_aprobados(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_antecedentes_aprobados(uuid[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.list_public_antecedentes_aprobados(uuid[]) IS
  '#110. Ids públicos (misma puerta que el perfil) que tienen el certificado aprobado. No devuelve el archivo, el DNI ni el apellido.';

-- Cuerpo vivo de get_public_worker_profile el 2026-10-09.
-- Único cambio: la clave antecedentes_penales (boolean). Nada del archivo.
CREATE OR REPLACE FUNCTION public.get_public_worker_profile(p_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    'descripcion', coalesce(NULLIF(trim(coalesce(p.professional_description, '')), ''), ''),
    'antecedentes_penales', EXISTS (
      SELECT 1
      FROM public.antecedentes_penales ap
      WHERE ap.user_id = p.id
        AND ap.status = 'aprobado'
    )
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

REVOKE ALL ON FUNCTION public.get_public_worker_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_worker_profile(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_worker_profile(uuid) IS
  '#110. Perfil público. antecedentes_penales es solo true/false. No incluye el archivo, el DNI ni el apellido.';

-- Cuerpo vivo de storage_referenced_paths el 2026-10-09.
-- Único cambio: el UNION del certificado vigente.
CREATE OR REPLACE FUNCTION public.storage_referenced_paths()
RETURNS TABLE(bucket_id text, object_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT bucket_id, object_path
  FROM (
    SELECT 'avatars'::text AS bucket_id,
           public.storage_path_from_url(p.avatar_url, 'avatars') AS object_path
    FROM public.profiles p
    WHERE coalesce(p.avatar_url, '') <> ''
    UNION ALL
    SELECT 'avatars',
           public.storage_path_from_url(s.avatar_url, 'avatars')
    FROM public.stores s
    WHERE coalesce(s.avatar_url, '') <> ''
    UNION ALL
    SELECT 'worker_videos',
           nullif(btrim(coalesce(p.intro_video_path, '')), '')
    FROM public.profiles p
    WHERE coalesce(p.intro_video_path, '') <> ''
    UNION ALL
    SELECT 'job-photos',
           public.storage_path_from_url(j.foto_url, 'job-photos')
    FROM public.jobs j
    WHERE coalesce(j.foto_url, '') <> ''
    UNION ALL
    SELECT 'job-photos',
           public.storage_path_from_url(u, 'job-photos')
    FROM public.jobs j
    CROSS JOIN LATERAL unnest(coalesce(j.photo_urls, '{}'::text[])) AS u
    WHERE j.photo_urls IS NOT NULL
    UNION ALL
    SELECT 'job-photos',
           public.storage_path_from_url(u, 'job-photos')
    FROM public.posts p
    CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[])) AS u
    WHERE p.image_urls IS NOT NULL
    UNION ALL
    SELECT
      coalesce(
        public.chat_image_storage_bucket(m.body),
        CASE
          WHEN m.body ILIKE '%/object/%/avatars/%' THEN 'avatars'
          WHEN m.body ILIKE '%/object/%/worker_videos/%' THEN 'worker_videos'
          WHEN m.body ILIKE '%/object/%/chat/%' THEN 'chat'
          ELSE 'job-photos'
        END
      ),
      coalesce(
        public.chat_image_storage_path(m.body),
        public.storage_path_from_url(m.body, 'job-photos'),
        public.storage_path_from_url(m.body, 'avatars'),
        public.storage_path_from_url(m.body, 'chat'),
        public.storage_path_from_url(m.body, 'worker_videos')
      )
    FROM public.messages m
    WHERE m.body ILIKE '%/storage/v1/object/%'
       OR m.type = 'image'
    UNION ALL
    SELECT 'antecedentes-penales',
           nullif(btrim(coalesce(a.storage_path, '')), '')
    FROM public.antecedentes_penales a
    WHERE coalesce(a.storage_path, '') <> ''
  ) x
  WHERE object_path IS NOT NULL AND object_path <> '';
$function$;

REVOKE ALL ON FUNCTION public.storage_referenced_paths() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_referenced_paths() TO postgres, service_role;

COMMENT ON FUNCTION public.storage_referenced_paths() IS
  '#110. Incluye el certificado vigente para que la purga no lo borre. Sigue sin EXECUTE para anon ni authenticated.';

COMMIT;
