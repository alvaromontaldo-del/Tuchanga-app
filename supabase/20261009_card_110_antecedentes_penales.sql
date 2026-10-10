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
--   * invoke_vault_edge_webhook(text, jsonb, integer) ya está aplicado.
--     Este script le suma el slug push_on_antecedentes sobre el cuerpo vivo
--     (pg_get_functiondef). No copia la anon key ni el secreto a este archivo.
--     El POST lo hace ese helper con net.http_post y vault.decrypted_secrets
--     name = edge_function_secret. El valor no se copia a este archivo.
--   * search_workers_for_client es el cuerpo vivo (md5
--     34092c74216bbf3a3a17971f1b098cbe). Solo se agrega la columna
--     antecedentes_penales. apellido sigue en NULL. Los grants no cambian
--     (anon ya tenía EXECUTE de la búsqueda; no gana una función nueva).
--
-- Orden cuando lo corra el coordinador:
--   1. Este SQL.
--   2. Deploy de push_on_antecedentes con verify_jwt = false
--      (autentica con x-function-secret, igual que los otros push).
--   3. La app. Sin el SQL, la pantalla avisa que la carga no está habilitada.
--
-- El listado admin devuelve storage_path y archivo_url null. El panel firma
-- con storage.from('antecedentes-penales').createSignedUrl(path, 600).
-- La policy SELECT deja pasar solo al dueño y a is_admin(). El bucket es
-- privado: no se arma una URL pública. El archivo anterior no se borra en
-- SQL: lo borra la app con la Storage API después de un submit exitoso.

BEGIN;

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

-- Suma el slug al helper vivo. La anon key queda en la función de producción
-- y no se escribe en este archivo.
DO $webhook_slug$
DECLARE
  v_def text := pg_get_functiondef('public.invoke_vault_edge_webhook(text,jsonb,integer)'::regprocedure);
BEGIN
  IF v_def NOT LIKE '%''push_on_antecedentes''%' THEN
    IF v_def NOT LIKE '%''notify_trabajo_no_conforme''%' THEN
      RAISE EXCEPTION 'invoke_vault_edge_webhook cambió: falta notify_trabajo_no_conforme.';
    END IF;
    v_def := replace(
      v_def,
      '''notify_trabajo_no_conforme''',
      '''notify_trabajo_no_conforme'',' || chr(10) || '    ''push_on_antecedentes'''
    );
    EXECUTE v_def;
  END IF;
END
$webhook_slug$;

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
BEGIN
  IF p_user_id IS NULL OR btrim(coalesce(p_asunto, '')) = '' THEN
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
        'asunto', btrim(p_asunto),
        'event_key', left(coalesce(p_event_key, ''), 240)
      ),
      'old_record', NULL
    ),
    5000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.notify_antecedentes_rechazo(uuid, text, text) IS
  '#110. Push al profesional con el asunto del rechazo. Delega en invoke_vault_edge_webhook (Vault + net.http_post). Sin EXECUTE para anon ni authenticated.';

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
  '#110. El profesional registra su archivo y queda en pendiente. Devuelve previous_path para que la app lo borre con la Storage API. No toca storage.objects. No puede aprobarse solo.';

CREATE OR REPLACE FUNCTION public.admin_list_antecedentes_pendientes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
      'archivo_url', NULL,
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
  '#110. Pendientes para el admin: nombre, apellido, oficio, DNI, mail y ruta. archivo_url queda null: firmar storage_path con createSignedUrl (600 s). Nunca una URL pública.';

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

-- Cuerpo vivo el 2026-10-10, md5 34092c74216bbf3a3a17971f1b098cbe.
-- Único cambio: la columna antecedentes_penales al final. apellido sigue NULL.
-- Cambiar el RETURNS TABLE exige DROP. Los grants quedan como hoy.
DO $search_guard$
BEGIN
  IF md5(pg_get_functiondef('public.search_workers_for_client(double precision,double precision,text,text[],uuid,integer)'::regprocedure))
     IS DISTINCT FROM '34092c74216bbf3a3a17971f1b098cbe' THEN
    RAISE EXCEPTION 'search_workers_for_client cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #110.';
  END IF;
END
$search_guard$;

DROP FUNCTION IF EXISTS public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer);

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
  antecedentes_penales boolean
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
  base AS (
    SELECT
      p.id AS profile_id,
      p.nombre,
      p.apellido AS apellido_full,
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
      ) AS antecedentes_penales
    FROM public.profiles p
    WHERE p.professional_status = 'accepted'
      AND p.location IS NOT NULL
      AND p.coverage_km IS NOT NULL
      AND p.coverage_km > 0
      AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
      AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.user_id = p.id)
  )
  SELECT
    b.profile_id,
    b.nombre,
    NULL::text AS apellido,
    b.avatar_url,
    round(b.lat_exact::numeric, 2)::double precision AS lat,
    round(b.lng_exact::numeric, 2)::double precision AS lng,
    b.coverage_km,
    round(b.distance_exact::numeric, 1)::double precision AS distance_km,
    b.primary_trade,
    b.all_trades,
    b.summary_jobs,
    b.rating_average,
    b.review_count,
    b.total_jobs_done,
    b.atiende_urgencias,
    b.antecedentes_penales
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
  ORDER BY b.distance_exact ASC, b.rating_average DESC NULLS LAST
  LIMIT (SELECT n FROM lim);
$function$;

REVOKE ALL ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) TO service_role;

COMMENT ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) IS
  '#110. Misma búsqueda. antecedentes_penales es solo true/false. apellido sigue NULL. No devuelve el archivo.';

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
