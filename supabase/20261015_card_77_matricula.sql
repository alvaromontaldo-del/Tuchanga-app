-- YaChanga #77. Matrícula verificada.
-- NO está aplicado. NO despliega la edge function. NO publica el bucket.
-- El panel admin se hace aparte: este archivo solo deja las RPC.
--
-- Producción (kyxehrxcdealbujvvnxp), leído el 2026-10-15 con pg_get_functiondef:
--   * search_workers_for_client md5 84471d7792642ded9e45e7cca0f85a47.
--     Único cambio: la columna matricula_verificada al final. apellido sigue NULL.
--     Los grants no cambian (anon ya tenía EXECUTE de la búsqueda).
--   * get_public_worker_profile md5 ad0c067dc0deb73ccd0c6c98b74fa7d5.
--     Único cambio: la clave booleana matricula_verificada. Sigue el nombre de
--     pila (split_part). No se agrega apellido, número, entidad ni fotos.
--   * invoke_vault_edge_webhook md5 f45e58f5d38e302412d3018c71c55ec9.
--     Se le suma el slug push_on_matricula sobre el cuerpo vivo. No se copia
--     la anon key ni el secreto. El POST lo hace ese helper con net.http_post
--     y vault.decrypted_secrets name = edge_function_secret.
--   * storage_referenced_paths md5 1a303fd9eac282e5c557a9bc94a91ee5.
--     Único cambio: el UNION de las fotos vigentes, para que la purga no las borre.
--   * is_admin() y _admin_require() no se reemplazan. Las RPC de admin las llaman.
--
-- Oficios que pueden cargarla (nombre plegado con search_fold, o el slug del catálogo):
--   gas / gasista, electricidad / electricista, plomeria, control de plagas y fumigacion.
--
-- Orden cuando lo corra el coordinador:
--   1. Este SQL.
--   2. Deploy de push_on_matricula con verify_jwt = false
--      (autentica con x-function-secret, igual que los otros push).
--   3. La app. Sin el SQL, la pantalla avisa que la carga no está habilitada.
--
-- RPC de admin para el panel (anon no tiene EXECUTE):
--   admin_list_matriculas_pendientes()
--   admin_aprobar_matricula(uuid)
--   admin_rechazar_matricula(uuid, text)
-- El listado devuelve storage_paths y archivo_url null. El panel firma cada
-- ruta con storage.from('matriculas').createSignedUrl(path, 600).
-- El bucket es privado. Las fotos anteriores no se borran en SQL: las borra
-- la app con storage.remove después de un submit exitoso.

BEGIN;

-- Postgres no admite subconsultas en un CHECK: la validación de rutas vive
-- en esta función IMMUTABLE (1 a 3 rutas, sin repetir, todas
-- <user_id>/<13 dígitos>-<6 a 12 letras/números>.jpg).
CREATE OR REPLACE FUNCTION public._matricula_paths_ok(p_user_id uuid, p_paths text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT p_user_id IS NOT NULL
    AND p_paths IS NOT NULL
    AND cardinality(p_paths) BETWEEN 1 AND 3
    AND (SELECT count(DISTINCT x) FROM unnest(p_paths) AS x) = cardinality(p_paths)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_paths) AS x
      WHERE x IS NULL
         OR x !~ ('^' || p_user_id::text || '/[0-9]{13}-[a-z0-9]{6,12}\.jpg$')
    );
$fn$;

REVOKE ALL ON FUNCTION public._matricula_paths_ok(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._matricula_paths_ok(uuid, text[]) TO service_role;

CREATE TABLE IF NOT EXISTS public.matriculas (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL,
  numero text NOT NULL,
  entidad text NOT NULL,
  storage_paths text[] NOT NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles (id),
  CONSTRAINT matriculas_status_chk
    CHECK (status IN ('pendiente', 'aprobada', 'rechazada')),
  CONSTRAINT matriculas_numero_chk
    CHECK (
      char_length(numero) BETWEEN 1 AND 40
      AND numero = btrim(numero)
      AND numero ~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,39}$'
    ),
  CONSTRAINT matriculas_entidad_chk
    CHECK (
      char_length(entidad) BETWEEN 2 AND 80
      AND entidad = btrim(entidad)
      AND entidad !~ '[[:cntrl:]]'
    ),
  CONSTRAINT matriculas_paths_chk
    CHECK (public._matricula_paths_ok(user_id, storage_paths)),
  CONSTRAINT matriculas_rechazo_chk
    CHECK (
      status <> 'rechazada'
      OR (
        rejection_reason IS NOT NULL
        AND btrim(rejection_reason) <> ''
        AND char_length(rejection_reason) <= 300
      )
    )
);

COMMENT ON TABLE public.matriculas IS
  '#77. Una matrícula por profesional. Las fotos viven en el bucket privado matriculas. El perfil público solo ve el booleano aprobada.';

COMMENT ON COLUMN public.matriculas.numero IS
  '#77. Número que cargó el profesional. No sale en el perfil público ni en la búsqueda.';

COMMENT ON COLUMN public.matriculas.entidad IS
  '#77. Entidad emisora. No sale en el perfil público ni en la búsqueda.';

COMMENT ON COLUMN public.matriculas.storage_paths IS
  '#77. Hasta 3 rutas jpg en el bucket privado. El perfil público no las ve.';

COMMENT ON COLUMN public.matriculas.rejection_reason IS
  '#77. Motivo que escribió el admin al rechazar. Viaja en el push y se muestra en la app.';

COMMENT ON COLUMN public.matriculas.reviewed_by IS
  '#77. Admin que aprobó o rechazó (auth.uid()).';

CREATE INDEX IF NOT EXISTS matriculas_pendientes_idx
  ON public.matriculas (updated_at)
  WHERE status = 'pendiente';

ALTER TABLE public.matriculas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matriculas_select_own ON public.matriculas;
CREATE POLICY matriculas_select_own
  ON public.matriculas
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.matriculas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.matriculas TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'matriculas',
  'matriculas',
  false,
  2097152,
  ARRAY['image/jpeg']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS matriculas_insert_own ON storage.objects;
CREATE POLICY matriculas_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'matriculas'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND coalesce(array_length(storage.foldername(name), 1), 0) = 1
    AND name ~ '\.jpg$'
  );

DROP POLICY IF EXISTS matriculas_select_own ON storage.objects;
CREATE POLICY matriculas_select_own
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'matriculas'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS matriculas_select_admin ON storage.objects;
CREATE POLICY matriculas_select_admin
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'matriculas'
    AND public.is_admin()
  );

DROP POLICY IF EXISTS matriculas_delete_own ON storage.objects;
CREATE POLICY matriculas_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'matriculas'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Suma el slug al helper vivo. La anon key queda en la función de producción
-- y no se escribe en este archivo. El secreto sigue en Vault.
DO $webhook_slug$
DECLARE
  v_def text := pg_get_functiondef('public.invoke_vault_edge_webhook(text,jsonb,integer)'::regprocedure);
BEGIN
  IF v_def NOT LIKE '%''push_on_matricula''%' THEN
    IF v_def NOT LIKE '%''push_on_antecedentes''%' THEN
      RAISE EXCEPTION 'invoke_vault_edge_webhook cambió: falta push_on_antecedentes.';
    END IF;
    IF v_def NOT LIKE '%edge_function_secret%' THEN
      RAISE EXCEPTION 'invoke_vault_edge_webhook cambió: falta el secreto de Vault.';
    END IF;
    v_def := replace(
      v_def,
      '''push_on_antecedentes''',
      '''push_on_antecedentes'',' || chr(10) || '    ''push_on_matricula'''
    );
    EXECUTE v_def;
  END IF;
END
$webhook_slug$;

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
        'event_key', left(coalesce(p_event_key, ''), 240)
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
  '#77. Push al profesional con el motivo del rechazo. Delega en invoke_vault_edge_webhook (Vault + net.http_post). Sin EXECUTE para anon ni authenticated.';

CREATE OR REPLACE FUNCTION public.get_my_matricula()
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
    'status', m.status,
    'numero', m.numero,
    'entidad', m.entidad,
    'motivo', CASE WHEN m.status = 'rechazada' THEN m.rejection_reason ELSE NULL END,
    'fotos', cardinality(m.storage_paths),
    'updated_at', m.updated_at
  )
    INTO v_row
  FROM public.matriculas m
  WHERE m.user_id = v_uid;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_matricula() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_matricula() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_my_matricula() IS
  '#77. Estado de la matrícula del profesional logueado. No devuelve las rutas ni una URL.';

CREATE OR REPLACE FUNCTION public.submit_my_matricula(
  p_numero text,
  p_entidad text,
  p_storage_paths text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_numero text := btrim(coalesce(p_numero, ''));
  v_entidad text := btrim(coalesce(p_entidad, ''));
  v_paths text[];
  v_path text;
  v_old text[];
  v_meta jsonb;
  v_size bigint;
  v_updated timestamptz;
  v_previous jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid) THEN
    RAISE EXCEPTION 'No encontramos tu perfil.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.user_id = v_uid
      AND public.search_fold(j.nombre_oficio) IN (
        'gas',
        'gasista',
        'electricidad',
        'electricista',
        'plomeria',
        'plomero',
        'control de plagas y fumigacion',
        'fumigacion'
      )
  ) THEN
    RAISE EXCEPTION 'La matrícula es para gasista, electricista, plomería o fumigación.';
  END IF;

  IF v_numero !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,39}$' THEN
    RAISE EXCEPTION 'El número puede tener hasta 40 caracteres: letras, números y guiones.';
  END IF;

  IF char_length(v_entidad) < 2 OR char_length(v_entidad) > 80 OR v_entidad ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Escribí la entidad que la emitió (hasta 80 caracteres).';
  END IF;

  SELECT coalesce(array_agg(btrim(p) ORDER BY ord), '{}'::text[])
    INTO v_paths
  FROM unnest(coalesce(p_storage_paths, '{}'::text[])) WITH ORDINALITY AS u(p, ord)
  WHERE btrim(coalesce(p, '')) <> '';

  IF cardinality(v_paths) < 1 OR cardinality(v_paths) > 3 THEN
    RAISE EXCEPTION 'Cargá entre 1 y 3 fotos.';
  END IF;

  IF (SELECT count(DISTINCT p) FROM unnest(v_paths) AS p) <> cardinality(v_paths) THEN
    RAISE EXCEPTION 'Las fotos están repetidas.';
  END IF;

  FOREACH v_path IN ARRAY v_paths LOOP
    IF v_path !~ ('^' || v_uid::text || '/[0-9]{13}-[a-z0-9]{6,12}\.jpg$') THEN
      RAISE EXCEPTION 'Una foto no corresponde a tu cuenta.';
    END IF;

    SELECT o.metadata
      INTO v_meta
    FROM storage.objects o
    WHERE o.bucket_id = 'matriculas'
      AND o.name = v_path;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No encontramos una de las fotos. Volvé a cargarlas.';
    END IF;

    v_size := coalesce((v_meta->>'size')::bigint, 0);
    IF v_size > 2097152 THEN
      RAISE EXCEPTION 'Una foto supera 2 MB.';
    END IF;
  END LOOP;

  SELECT m.storage_paths
    INTO v_old
  FROM public.matriculas m
  WHERE m.user_id = v_uid;

  INSERT INTO public.matriculas (
    user_id, status, numero, entidad, storage_paths, rejection_reason, reviewed_at, reviewed_by, updated_at
  ) VALUES (
    v_uid, 'pendiente', v_numero, v_entidad, v_paths, NULL, NULL, NULL, now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET status = 'pendiente',
      numero = EXCLUDED.numero,
      entidad = EXCLUDED.entidad,
      storage_paths = EXCLUDED.storage_paths,
      rejection_reason = NULL,
      reviewed_at = NULL,
      reviewed_by = NULL,
      updated_at = now()
  RETURNING updated_at INTO v_updated;

  SELECT coalesce(jsonb_agg(oldp), '[]'::jsonb)
    INTO v_previous
  FROM unnest(coalesce(v_old, '{}'::text[])) AS oldp
  WHERE oldp <> ALL (v_paths);

  RETURN jsonb_build_object(
    'status', 'pendiente',
    'numero', v_numero,
    'entidad', v_entidad,
    'motivo', NULL,
    'fotos', cardinality(v_paths),
    'updated_at', v_updated,
    'previous_paths', v_previous
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_my_matricula(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_my_matricula(text, text, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_my_matricula(text, text, text[]) IS
  '#77. El profesional registra número, entidad y fotos, y queda en pendiente. Devuelve previous_paths para que la app las borre con storage.remove. No puede aprobarse solo.';

CREATE OR REPLACE FUNCTION public.admin_list_matriculas_pendientes()
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
      'user_id', m.user_id,
      'nombre', coalesce(nullif(btrim(p.nombre), ''), ''),
      'apellido', coalesce(nullif(btrim(p.apellido), ''), ''),
      'oficio', coalesce((
        SELECT j.nombre_oficio
        FROM public.jobs j
        WHERE j.user_id = m.user_id
        ORDER BY j.es_principal DESC NULLS LAST, j.created_at
        LIMIT 1
      ), ''),
      'dni', coalesce(nullif(btrim(p.dni), ''), ''),
      'email', coalesce(u.email, ''),
      'numero', m.numero,
      'entidad', m.entidad,
      'storage_bucket', 'matriculas',
      'storage_paths', to_jsonb(m.storage_paths),
      'archivo_url', NULL,
      'archivo_url_expira_en_segundos', 600,
      'updated_at', m.updated_at
    ) AS item
    FROM public.matriculas m
    JOIN public.profiles p ON p.id = m.user_id
    LEFT JOIN auth.users u ON u.id = m.user_id
    WHERE m.status = 'pendiente'
  ) q;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_matriculas_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_matriculas_pendientes() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_matriculas_pendientes() IS
  '#77. Pendientes para el admin: nombre, apellido, oficio, DNI, mail, número, entidad y rutas. archivo_url queda null: firmar cada storage_path con createSignedUrl (600 s). Nunca una URL pública. Anon no tiene EXECUTE.';

CREATE OR REPLACE FUNCTION public.admin_aprobar_matricula(p_user_id uuid)
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

  SELECT m.status
    INTO v_status
  FROM public.matriculas m
  WHERE m.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una matrícula para este usuario.';
  END IF;

  IF v_status IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'No hay una matrícula pendiente para este usuario.';
  END IF;

  UPDATE public.matriculas
  SET status = 'aprobada',
      rejection_reason = NULL,
      reviewed_at = v_at,
      reviewed_by = v_admin,
      updated_at = v_at
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status', 'aprobada',
    'reviewed_at', v_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_aprobar_matricula(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_aprobar_matricula(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_aprobar_matricula(uuid) IS
  '#77. Pasa un pendiente a aprobada. El perfil público muestra la insignia. No devuelve las fotos. Anon no tiene EXECUTE.';

CREATE OR REPLACE FUNCTION public.admin_rechazar_matricula(
  p_user_id uuid,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_status text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
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

  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Tenés que indicar el motivo del rechazo.';
  END IF;

  IF char_length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'El motivo puede tener hasta 300 caracteres.';
  END IF;

  SELECT m.status
    INTO v_status
  FROM public.matriculas m
  WHERE m.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una matrícula para este usuario.';
  END IF;

  IF v_status IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'No hay una matrícula pendiente para este usuario.';
  END IF;

  UPDATE public.matriculas
  SET status = 'rechazada',
      rejection_reason = v_motivo,
      reviewed_at = v_at,
      reviewed_by = v_admin,
      updated_at = v_at
  WHERE user_id = p_user_id;

  v_event := 'matricula:' || p_user_id::text || ':' || floor(extract(epoch FROM v_at))::text;
  PERFORM public.notify_matricula_rechazo(p_user_id, v_motivo, v_event);

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status', 'rechazada',
    'motivo', v_motivo,
    'reviewed_at', v_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_rechazar_matricula(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rechazar_matricula(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_rechazar_matricula(uuid, text) IS
  '#77. Rechaza un pendiente con motivo, lo guarda para la app y dispara el push. El secreto sale de Vault. Anon no tiene EXECUTE.';

-- Cuerpo vivo el 2026-10-15, md5 84471d7792642ded9e45e7cca0f85a47.
-- Único cambio: la columna matricula_verificada al final. apellido sigue NULL.
-- Cambiar el RETURNS TABLE exige DROP. Los grants quedan como hoy.
DO $search_guard$
BEGIN
  IF md5(pg_get_functiondef('public.search_workers_for_client(double precision,double precision,text,text[],uuid,integer)'::regprocedure))
     IS DISTINCT FROM '84471d7792642ded9e45e7cca0f85a47' THEN
    RAISE EXCEPTION 'search_workers_for_client cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #77.';
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
    b.antecedentes_penales,
    b.matricula_verificada
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
  '#77. Misma búsqueda. antecedentes_penales y matricula_verificada son solo true/false. apellido sigue NULL. No devuelve fotos ni el número.';

-- Cuerpo vivo de get_public_worker_profile el 2026-10-15, md5 ad0c067dc0deb73ccd0c6c98b74fa7d5.
-- Único cambio: la clave matricula_verificada (boolean). Nada del archivo.
DO $profile_guard$
BEGIN
  IF md5(pg_get_functiondef('public.get_public_worker_profile(uuid)'::regprocedure))
     IS DISTINCT FROM 'ad0c067dc0deb73ccd0c6c98b74fa7d5' THEN
    RAISE EXCEPTION 'get_public_worker_profile cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #77.';
  END IF;
END
$profile_guard$;

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
    ),
    'matricula_verificada', EXISTS (
      SELECT 1
      FROM public.matriculas mv
      WHERE mv.user_id = p.id
        AND mv.status = 'aprobada'
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
  '#77. Perfil público. matricula_verificada y antecedentes_penales son solo true/false. No incluye fotos, número, DNI ni apellido.';

-- Cuerpo vivo de storage_referenced_paths el 2026-10-15, md5 1a303fd9eac282e5c557a9bc94a91ee5.
-- Único cambio: el UNION de las fotos vigentes de la matrícula.
DO $paths_guard$
BEGIN
  IF md5(pg_get_functiondef('public.storage_referenced_paths()'::regprocedure))
     IS DISTINCT FROM '1a303fd9eac282e5c557a9bc94a91ee5' THEN
    RAISE EXCEPTION 'storage_referenced_paths cambió en producción. Volvé a copiar el cuerpo vivo antes de aplicar #77.';
  END IF;
END
$paths_guard$;

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
    UNION ALL
    SELECT 'matriculas',
           nullif(btrim(coalesce(u, '')), '')
    FROM public.matriculas mv
    CROSS JOIN LATERAL unnest(coalesce(mv.storage_paths, '{}'::text[])) AS u
    WHERE coalesce(u, '') <> ''
  ) x
  WHERE object_path IS NOT NULL AND object_path <> '';
$function$;

REVOKE ALL ON FUNCTION public.storage_referenced_paths() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_referenced_paths() TO postgres, service_role;

COMMENT ON FUNCTION public.storage_referenced_paths() IS
  '#77. Incluye las fotos vigentes de la matrícula para que la purga no las borre. Sigue sin EXECUTE para anon ni authenticated.';

COMMIT;
