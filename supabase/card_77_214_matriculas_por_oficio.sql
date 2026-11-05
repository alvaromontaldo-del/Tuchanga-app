-- #77 + #214. Matrícula por oficio, fotos con estado propio, antecedentes eliminables
-- y sellos del feed. Parte del esquema vivo del 2026-11-05 (nov5_live_license_schema).
--
-- NO asigna matrículas viejas al oficio principal. El esquema vivo no guarda oficio
-- en public.matriculas (PK user_id, sin columna de oficio ni FK a jobs). No hay vínculo
-- demostrable: cada fila existente queda con oficio_codigo = 'sin_vincular'.
-- Ese valor NO es gas, electricidad, plomería ni fumigación. No extiende la aprobación.
-- No borra storage_paths, números, entidades ni estados.
--
-- Caso sin resolver: toda fila previa a esta migración. Para contarla, después de aplicar:
--   SELECT status, count(*) FROM public.matriculas
--    WHERE oficio_codigo = 'sin_vincular' GROUP BY status;
-- Conteo de solo lectura del 2026-11-05, sin datos personales: 2 filas, ambas
-- aprobadas, y cada una con un único oficio elegible en jobs. Tampoco se vinculan.
-- La matrícula no guarda ese oficio. Un operador puede vincularla a mano
-- solo con evidencia externa.
--
-- App ya publicada: get_my_matricula / submit_my_matricula / admin_aprobar_matricula(uuid)
-- siguen operando SOLO sobre sin_vincular. No pisan las filas de un oficio.
-- matricula_verificada sigue siendo boolean: verdadero si algún oficio está verificado
-- o si el legado sin_vincular sigue aprobado y con al menos una foto aprobada.
-- Los íconos del feed salen solo de oficios verificados, nunca del legado.
--
-- Dry-run (no deja cambios; no ejecutar contra producción sin esta envoltura de prueba):
--   BEGIN;
--   \i supabase/card_77_214_matriculas_por_oficio.sql
--   ROLLBACK;
-- Este archivo no se aplicó a producción.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'matriculas'
      AND column_name = 'oficio_codigo'
  ) THEN
    RAISE EXCEPTION 'card 77/214 ya aplicada: matriculas.oficio_codigo existe. No se reejecuta.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._matricula_paths_ok(p_user_id uuid, p_paths text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_paths IS NOT NULL
    AND (
      cardinality(p_paths) = 0
      OR (
        cardinality(p_paths) BETWEEN 1 AND 3
        AND (SELECT count(DISTINCT x) FROM unnest(p_paths) AS x) = cardinality(p_paths)
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(p_paths) AS x
          WHERE x IS NULL
             OR x !~ ('^' || p_user_id::text || '/[0-9]{13}-[a-z0-9]{6,12}\.jpg$')
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public._matricula_paths_ok(uuid, text[]) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.matriculas
  ADD COLUMN oficio_codigo text;

COMMENT ON COLUMN public.matriculas.oficio_codigo IS
  'gas, electricidad, plomeria o fumigacion. sin_vincular = legado sin evidencia de oficio. No se infiere del oficio principal.';

-- Asociación explícita de “no hay evidencia”. No lee jobs ni es_principal.
UPDATE public.matriculas
   SET oficio_codigo = 'sin_vincular'
 WHERE oficio_codigo IS NULL;

ALTER TABLE public.matriculas
  ALTER COLUMN oficio_codigo SET NOT NULL;

ALTER TABLE public.matriculas
  ADD CONSTRAINT matriculas_oficio_codigo_chk
  CHECK (oficio_codigo IN ('gas', 'electricidad', 'plomeria', 'fumigacion', 'sin_vincular'));

ALTER TABLE public.matriculas DROP CONSTRAINT matriculas_pkey;
ALTER TABLE public.matriculas
  ADD CONSTRAINT matriculas_pkey PRIMARY KEY (user_id, oficio_codigo);

-- Versión explícita de la identidad (número + entidad). No usa now():
-- dentro de una transacción el reloj no avanza y dos cambios quedarían iguales.
ALTER TABLE public.matriculas ADD COLUMN identidad_version integer;
UPDATE public.matriculas SET identidad_version = 1 WHERE identidad_version IS NULL;
ALTER TABLE public.matriculas ALTER COLUMN identidad_version SET NOT NULL;
ALTER TABLE public.matriculas
  ADD CONSTRAINT matriculas_identidad_version_chk CHECK (identidad_version >= 1);
COMMENT ON COLUMN public.matriculas.identidad_version IS
  'Sube 1 al crear la matrícula y cada vez que cambian número o entidad. Las fotos guardan la versión con la que se cargaron.';

CREATE TABLE public.matricula_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  oficio_codigo text NOT NULL,
  storage_path text NOT NULL,
  identidad_version integer NOT NULL,
  status text NOT NULL DEFAULT 'pendiente',
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matricula_fotos_user_oficio_fkey
    FOREIGN KEY (user_id, oficio_codigo)
    REFERENCES public.matriculas (user_id, oficio_codigo)
    ON DELETE CASCADE,
  CONSTRAINT matricula_fotos_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT matricula_fotos_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.profiles (id),
  CONSTRAINT matricula_fotos_path_key UNIQUE (storage_path),
  CONSTRAINT matricula_fotos_version_chk CHECK (identidad_version >= 1),
  CONSTRAINT matricula_fotos_oficio_chk
    CHECK (oficio_codigo IN ('gas', 'electricidad', 'plomeria', 'fumigacion', 'sin_vincular')),
  CONSTRAINT matricula_fotos_status_chk
    CHECK (status IN ('pendiente', 'aprobada', 'rechazada')),
  CONSTRAINT matricula_fotos_path_chk
    CHECK (storage_path ~ ('^' || user_id::text || '/[0-9]{13}-[a-z0-9]{6,12}\.jpg$')),
  CONSTRAINT matricula_fotos_rechazo_chk
    CHECK (
      status <> 'rechazada'
      OR (
        rejection_reason IS NOT NULL
        AND btrim(rejection_reason) <> ''
        AND char_length(rejection_reason) <= 300
      )
    )
);

COMMENT ON TABLE public.matricula_fotos IS
  'Estado por foto. El legado se copia con el mismo estado del envío y oficio_codigo sin_vincular.';

CREATE INDEX matricula_fotos_user_oficio_idx
  ON public.matricula_fotos (user_id, oficio_codigo);

CREATE INDEX matricula_fotos_pendientes_idx
  ON public.matricula_fotos (created_at)
  WHERE status = 'pendiente';

CREATE INDEX matricula_fotos_aprobadas_idx
  ON public.matricula_fotos (user_id, oficio_codigo, identidad_version)
  WHERE status = 'aprobada';

CREATE INDEX matricula_fotos_reviewed_by_idx
  ON public.matricula_fotos (reviewed_by);

ALTER TABLE public.matricula_fotos ENABLE ROW LEVEL SECURITY;

CREATE POLICY matricula_fotos_select_own
  ON public.matricula_fotos
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Los defaults de Supabase dejan DML y TRUNCATE en authenticated. TRUNCATE no pasa por RLS.
REVOKE ALL ON TABLE public.matricula_fotos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.matricula_fotos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.matricula_fotos TO service_role;

-- Paths ya aceptados. No se borran al eliminar la foto: un objeto que sigue en
-- Storage no puede volver a entrar como evidencia nueva.
CREATE TABLE public.matricula_paths_usados (
  storage_path text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matricula_paths_usados_path_chk
    CHECK (storage_path ~ ('^' || user_id::text || '/[0-9]{13}-[a-z0-9]{6,12}\.jpg$'))
);
ALTER TABLE public.matricula_paths_usados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.matricula_paths_usados FROM PUBLIC, anon, authenticated;

-- Copia la evidencia y el estado del envío. No elige oficio.
INSERT INTO public.matricula_fotos (
  user_id, oficio_codigo, storage_path, identidad_version, status, rejection_reason, reviewed_at, reviewed_by, created_at
)
SELECT
  m.user_id,
  'sin_vincular',
  btrim(p.path),
  m.identidad_version,
  m.status,
  CASE WHEN m.status = 'rechazada' THEN m.rejection_reason ELSE NULL END,
  m.reviewed_at,
  m.reviewed_by,
  m.created_at
FROM public.matriculas m
CROSS JOIN LATERAL unnest(m.storage_paths) AS p(path)
WHERE m.oficio_codigo = 'sin_vincular'
  AND btrim(coalesce(p.path, '')) <> '';

INSERT INTO public.matricula_paths_usados (storage_path, user_id)
SELECT btrim(p.path), m.user_id
FROM public.matriculas m
CROSS JOIN LATERAL unnest(m.storage_paths) AS p(path)
WHERE m.oficio_codigo = 'sin_vincular'
  AND btrim(coalesce(p.path, '')) <> ''
ON CONFLICT (storage_path) DO NOTHING;

DO $$
DECLARE
  v_trade int;
BEGIN
  SELECT count(*) INTO v_trade
  FROM public.matriculas
  WHERE oficio_codigo <> 'sin_vincular';
  IF v_trade <> 0 THEN
    RAISE EXCEPTION 'La migración no debe crear matrículas de oficio. Hay % filas.', v_trade;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._matricula_oficio_codigo(p_nombre text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE public.search_fold(coalesce(p_nombre, ''))
    WHEN 'gas' THEN 'gas'
    WHEN 'gasista' THEN 'gas'
    WHEN 'electricidad' THEN 'electricidad'
    WHEN 'electricista' THEN 'electricidad'
    WHEN 'plomeria' THEN 'plomeria'
    WHEN 'plomero' THEN 'plomeria'
    WHEN 'control de plagas y fumigacion' THEN 'fumigacion'
    WHEN 'fumigacion' THEN 'fumigacion'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public._matricula_validar_paths(p_user_id uuid, p_storage_paths text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paths text[];
  v_path text;
  v_meta jsonb;
  v_size bigint;
BEGIN
  SELECT coalesce(array_agg(btrim(p) ORDER BY ord), '{}'::text[])
    INTO v_paths
  FROM unnest(coalesce(p_storage_paths, '{}'::text[])) WITH ORDINALITY AS u(p, ord)
  WHERE btrim(coalesce(p, '')) <> '';

  IF coalesce(cardinality(v_paths), 0) > 0
     AND (SELECT count(DISTINCT p) FROM unnest(v_paths) AS p) <> cardinality(v_paths) THEN
    RAISE EXCEPTION 'Las fotos están repetidas.';
  END IF;

  IF coalesce(cardinality(v_paths), 0) = 0 THEN
    RETURN '{}'::text[];
  END IF;

  FOREACH v_path IN ARRAY v_paths LOOP
    IF v_path !~ ('^' || p_user_id::text || '/[0-9]{13}-[a-z0-9]{6,12}\.jpg$') THEN
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

  RETURN v_paths;
END;
$function$;

CREATE OR REPLACE FUNCTION public._matricula_sync_paths(p_user_id uuid, p_oficio text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.matriculas m
  SET storage_paths = coalesce((
        SELECT array_agg(f.storage_path ORDER BY f.created_at, f.id)
        FROM public.matricula_fotos f
        WHERE f.user_id = p_user_id
          AND f.oficio_codigo = p_oficio
      ), '{}'::text[]),
      updated_at = now()
  WHERE m.user_id = p_user_id
    AND m.oficio_codigo = p_oficio;
END;
$function$;

-- El sello exige que el admin haya aprobado la identidad actual (número y entidad)
-- y que quede al menos una foto aprobada. Sumar fotos no cambia el status.
-- Cambiar número o entidad lo pasa a pendiente: las fotos viejas no se borran
-- ni se rechazan, pero no alcanzan para mostrar verificado el dato nuevo.
CREATE OR REPLACE FUNCTION public._oficio_verificado(p_user_id uuid, p_oficio text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    WHERE m.user_id = p_user_id
      AND m.oficio_codigo = p_oficio
      AND m.status = 'aprobada'
      AND EXISTS (
        SELECT 1
        FROM public.matricula_fotos f
        WHERE f.user_id = m.user_id
          AND f.oficio_codigo = m.oficio_codigo
          AND f.status = 'aprobada'
          AND f.identidad_version = m.identidad_version
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public._matricula_publica_verificada(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    WHERE m.user_id = p_user_id
      AND public._oficio_verificado(m.user_id, m.oficio_codigo)
  );
$function$;

CREATE OR REPLACE FUNCTION public._matriculas_oficios_verificados(p_user_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(u.code ORDER BY u.ord), '{}'::text[])
  FROM unnest(ARRAY['gas', 'electricidad', 'plomeria', 'fumigacion']::text[]) WITH ORDINALITY AS u(code, ord)
  WHERE public._oficio_verificado(p_user_id, u.code);
$function$;

CREATE OR REPLACE FUNCTION public._worker_antecedentes_aprobado(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.antecedentes_penales ap
    WHERE ap.user_id = p_user_id
      AND ap.status = 'aprobado'
  );
$function$;

CREATE OR REPLACE FUNCTION public._matricula_fotos_json(p_user_id uuid, p_oficio text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'status', f.status,
    'motivo', CASE WHEN f.status = 'rechazada' THEN f.rejection_reason ELSE NULL END,
    'storage_path', f.storage_path,
    'identidad_version', f.identidad_version
  ) ORDER BY f.created_at, f.id), '[]'::jsonb)
  FROM public.matricula_fotos f
  WHERE f.user_id = p_user_id
    AND f.oficio_codigo = p_oficio;
$function$;

REVOKE ALL ON FUNCTION public._matricula_oficio_codigo(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._matricula_validar_paths(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._matricula_sync_paths(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._oficio_verificado(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._matricula_publica_verificada(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._matriculas_oficios_verificados(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._worker_antecedentes_aprobado(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._matricula_fotos_json(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._matricula_reservar_paths(
  p_user_id uuid,
  p_oficio text,
  p_paths text[]
)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(cardinality(p_paths), 0) = 0 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_paths) AS p(path)
    WHERE EXISTS (
      SELECT 1
      FROM public.matricula_paths_usados u
      WHERE u.storage_path = p.path
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.matricula_fotos f
      WHERE f.storage_path = p.path
        AND f.user_id = p_user_id
        AND f.oficio_codigo = p_oficio
    )
  ) THEN
    RAISE EXCEPTION 'Esa foto ya se usó. Sacala de nuevo.';
  END IF;

  INSERT INTO public.matricula_paths_usados (storage_path, user_id)
  SELECT p.path, p_user_id
  FROM unnest(p_paths) AS p(path)
  ON CONFLICT (storage_path) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public._matricula_revision_vigente(
  p_user_id uuid,
  p_oficio text,
  p_identidad_version integer,
  p_foto_ids uuid[]
)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_version integer;
  v_actual uuid[];
  v_pedido uuid[];
BEGIN
  SELECT m.identidad_version
    INTO v_version
  FROM public.matriculas m
  WHERE m.user_id = p_user_id
    AND m.oficio_codigo = p_oficio
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una matrícula para este usuario.';
  END IF;

  SELECT coalesce(array_agg(f.id ORDER BY f.id), '{}'::uuid[])
    INTO v_actual
  FROM public.matricula_fotos f
  WHERE f.user_id = p_user_id
    AND f.oficio_codigo = p_oficio
    AND f.status = 'pendiente'
    AND f.identidad_version = v_version;

  SELECT coalesce(array_agg(s.id ORDER BY s.id), '{}'::uuid[])
    INTO v_pedido
  FROM (
    SELECT DISTINCT u AS id
    FROM unnest(coalesce(p_foto_ids, '{}'::uuid[])) AS u
    WHERE u IS NOT NULL
  ) s;

  IF p_identidad_version IS DISTINCT FROM v_version OR v_actual IS DISTINCT FROM v_pedido THEN
    RAISE EXCEPTION 'La revisión quedó vieja. Recargá antes de aprobar o rechazar.';
  END IF;

  RETURN v_version;
END;
$function$;

REVOKE ALL ON FUNCTION public._matricula_reservar_paths(uuid, text, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._matricula_revision_vigente(uuid, text, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_matricula()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Compatibilidad con la app ya publicada: solo el legado, nunca un oficio adivinado.
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
  WHERE m.user_id = v_uid
    AND m.oficio_codigo = 'sin_vincular';

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_matriculas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_oficios jsonb;
  v_legado jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY array_position(ARRAY['gas','electricidad','plomeria','fumigacion'], item->>'oficio')), '[]'::jsonb)
    INTO v_oficios
  FROM (
    SELECT jsonb_build_object(
      'oficio', m.oficio_codigo,
      'status', m.status,
      'numero', m.numero,
      'entidad', m.entidad,
      'motivo', CASE WHEN m.status = 'rechazada' THEN m.rejection_reason ELSE NULL END,
      'identidad_version', m.identidad_version,
      'verificada', public._oficio_verificado(m.user_id, m.oficio_codigo),
      'fotos', public._matricula_fotos_json(m.user_id, m.oficio_codigo)
    ) AS item
    FROM public.matriculas m
    WHERE m.user_id = v_uid
      AND m.oficio_codigo IN ('gas', 'electricidad', 'plomeria', 'fumigacion')
  ) q;

  SELECT jsonb_build_object(
    'vinculo', 'sin_evidencia',
    'status', m.status,
    'numero', m.numero,
    'entidad', m.entidad,
    'motivo', CASE WHEN m.status = 'rechazada' THEN m.rejection_reason ELSE NULL END,
    'identidad_version', m.identidad_version,
    'verificada', public._oficio_verificado(m.user_id, m.oficio_codigo),
    'fotos', public._matricula_fotos_json(m.user_id, m.oficio_codigo)
  )
    INTO v_legado
  FROM public.matriculas m
  WHERE m.user_id = v_uid
    AND m.oficio_codigo = 'sin_vincular';

  RETURN jsonb_build_object('oficios', coalesce(v_oficios, '[]'::jsonb), 'legado', v_legado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_my_matricula(p_numero text, p_entidad text, p_storage_paths text[])
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
  v_old text[];
  v_old_numero text;
  v_old_entidad text;
  v_version integer;
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
      AND public._matricula_oficio_codigo(j.nombre_oficio) IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'La matrícula es para gasista, electricista, plomería o fumigación.';
  END IF;

  IF v_numero !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,39}$' THEN
    RAISE EXCEPTION 'El número puede tener hasta 40 caracteres: letras, números y guiones.';
  END IF;

  IF char_length(v_entidad) < 2 OR char_length(v_entidad) > 80 OR v_entidad ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Escribí la entidad que la emitió (hasta 80 caracteres).';
  END IF;

  v_paths := public._matricula_validar_paths(v_uid, p_storage_paths);
  IF coalesce(cardinality(v_paths), 0) < 1 OR cardinality(v_paths) > 3 THEN
    RAISE EXCEPTION 'Cargá entre 1 y 3 fotos.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matricula_fotos f
    WHERE f.storage_path = ANY (v_paths)
      AND (f.user_id <> v_uid OR f.oficio_codigo <> 'sin_vincular')
  ) THEN
    RAISE EXCEPTION 'Una foto no corresponde a esta matrícula.';
  END IF;

  PERFORM public._matricula_reservar_paths(v_uid, 'sin_vincular', v_paths);

  SELECT m.storage_paths, m.numero, m.entidad, m.identidad_version
    INTO v_old, v_old_numero, v_old_entidad, v_version
  FROM public.matriculas m
  WHERE m.user_id = v_uid
    AND m.oficio_codigo = 'sin_vincular'
  FOR UPDATE;

  IF NOT FOUND THEN
    v_version := 1;
  ELSIF v_numero IS DISTINCT FROM v_old_numero OR v_entidad IS DISTINCT FROM v_old_entidad THEN
    v_version := v_version + 1;
  END IF;

  INSERT INTO public.matriculas (
    user_id, oficio_codigo, status, numero, entidad, identidad_version, storage_paths, rejection_reason, reviewed_at, reviewed_by, updated_at
  ) VALUES (
    v_uid, 'sin_vincular', 'pendiente', v_numero, v_entidad, v_version, '{}'::text[], NULL, NULL, NULL, now()
  )
  ON CONFLICT (user_id, oficio_codigo) DO UPDATE
  SET status = 'pendiente',
      numero = EXCLUDED.numero,
      entidad = EXCLUDED.entidad,
      identidad_version = EXCLUDED.identidad_version,
      rejection_reason = NULL,
      reviewed_at = NULL,
      reviewed_by = NULL,
      updated_at = now()
  RETURNING updated_at INTO v_updated;

  DELETE FROM public.matricula_fotos f
  WHERE f.user_id = v_uid
    AND f.oficio_codigo = 'sin_vincular'
    AND f.storage_path <> ALL (v_paths);

  INSERT INTO public.matricula_fotos (user_id, oficio_codigo, storage_path, identidad_version, status)
  SELECT v_uid, 'sin_vincular', p, v_version, 'pendiente'
  FROM unnest(v_paths) AS p
  ON CONFLICT (storage_path) DO UPDATE
  SET status = 'pendiente',
      identidad_version = EXCLUDED.identidad_version,
      rejection_reason = NULL,
      reviewed_at = NULL,
      reviewed_by = NULL,
      oficio_codigo = 'sin_vincular'
  WHERE matricula_fotos.user_id = v_uid
    AND matricula_fotos.oficio_codigo = 'sin_vincular';

  PERFORM public._matricula_sync_paths(v_uid, 'sin_vincular');

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

CREATE OR REPLACE FUNCTION public.submit_my_matricula_oficio(
  p_oficio text,
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
  v_oficio text := lower(btrim(coalesce(p_oficio, '')));
  v_numero text := btrim(coalesce(p_numero, ''));
  v_entidad text := btrim(coalesce(p_entidad, ''));
  v_paths text[];
  v_status text;
  v_old_numero text;
  v_old_entidad text;
  v_version integer;
  v_count int;
  v_changed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_oficio NOT IN ('gas', 'electricidad', 'plomeria', 'fumigacion') THEN
    RAISE EXCEPTION 'El oficio de la matrícula no es válido.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid) THEN
    RAISE EXCEPTION 'No encontramos tu perfil.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.user_id = v_uid
      AND public._matricula_oficio_codigo(j.nombre_oficio) = v_oficio
  ) THEN
    RAISE EXCEPTION 'Ese oficio no está guardado en tu perfil.';
  END IF;
  IF v_numero !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,39}$' THEN
    RAISE EXCEPTION 'El número puede tener hasta 40 caracteres: letras, números y guiones.';
  END IF;
  IF char_length(v_entidad) < 2 OR char_length(v_entidad) > 80 OR v_entidad ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Escribí la entidad que la emitió (hasta 80 caracteres).';
  END IF;

  v_paths := public._matricula_validar_paths(v_uid, p_storage_paths);

  SELECT m.status, m.numero, m.entidad, m.identidad_version
    INTO v_status, v_old_numero, v_old_entidad, v_version
  FROM public.matriculas m
  WHERE m.user_id = v_uid
    AND m.oficio_codigo = v_oficio
  FOR UPDATE;

  IF NOT FOUND THEN
    IF coalesce(cardinality(v_paths), 0) < 1 THEN
      RAISE EXCEPTION 'Sumá al menos una foto de la matrícula.';
    END IF;
    v_version := 1;
    v_changed := false;
    v_status := 'pendiente';
    INSERT INTO public.matriculas (
      user_id, oficio_codigo, status, numero, entidad, identidad_version, storage_paths, rejection_reason, reviewed_at, reviewed_by, updated_at
    ) VALUES (
      v_uid, v_oficio, 'pendiente', v_numero, v_entidad, v_version, '{}'::text[], NULL, NULL, NULL, now()
    );
  ELSE
    v_changed := v_numero IS DISTINCT FROM v_old_numero OR v_entidad IS DISTINCT FROM v_old_entidad;
    IF v_changed THEN
      v_version := v_version + 1;
    END IF;
  END IF;

  SELECT count(*)::int
    INTO v_count
  FROM public.matricula_fotos f
  WHERE f.user_id = v_uid
    AND f.oficio_codigo = v_oficio;

  IF v_changed AND v_count + greatest(coalesce(cardinality(v_paths), 0), 1) > 3 THEN
    RAISE EXCEPTION 'Para cambiar el número o entidad, eliminá una foto anterior para cargar la nueva.';
  END IF;
  IF v_status = 'rechazada' AND NOT v_changed AND coalesce(cardinality(v_paths), 0) < 1 THEN
    RAISE EXCEPTION 'Para volver a enviar una matrícula rechazada tenés que sumar una foto nueva.';
  END IF;
  IF v_changed AND coalesce(cardinality(v_paths), 0) < 1 THEN
    RAISE EXCEPTION 'Para cambiar el número o la entidad tenés que sumar una foto nueva.';
  END IF;
  IF v_count + coalesce(cardinality(v_paths), 0) > 3 THEN
    RAISE EXCEPTION 'Podés cargar hasta 3 fotos.';
  END IF;

  PERFORM public._matricula_reservar_paths(v_uid, v_oficio, v_paths);

  IF coalesce(cardinality(v_paths), 0) > 0 AND EXISTS (
    SELECT 1 FROM public.matricula_fotos f WHERE f.storage_path = ANY (v_paths)
  ) THEN
    RAISE EXCEPTION 'Una foto ya estaba cargada.';
  END IF;

  IF coalesce(cardinality(v_paths), 0) > 0 THEN
    INSERT INTO public.matricula_fotos (user_id, oficio_codigo, storage_path, identidad_version, status)
    SELECT v_uid, v_oficio, p, v_version, 'pendiente'
    FROM unnest(v_paths) AS p;
  END IF;

  -- Identidad distinta: sube la versión y pasa a pendiente. No borra fotos ni les cambia
  -- el estado ni la versión. No toca otros oficios.
  IF v_changed OR v_status = 'rechazada' THEN
    UPDATE public.matriculas
    SET numero = v_numero,
        entidad = v_entidad,
        identidad_version = v_version,
        status = 'pendiente',
        rejection_reason = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        updated_at = now()
    WHERE user_id = v_uid
      AND oficio_codigo = v_oficio;
  ELSE
    UPDATE public.matriculas
    SET numero = v_numero,
        entidad = v_entidad,
        updated_at = now()
    WHERE user_id = v_uid
      AND oficio_codigo = v_oficio;
  END IF;

  PERFORM public._matricula_sync_paths(v_uid, v_oficio);

  RETURN jsonb_build_object(
    'oficio', v_oficio,
    'status', CASE WHEN v_status = 'rechazada' OR v_changed OR v_status IS NULL THEN 'pendiente' ELSE v_status END,
    'verificada', public._oficio_verificado(v_uid, v_oficio),
    'fotos', public._matricula_fotos_json(v_uid, v_oficio),
    'previous_paths', '[]'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_my_matricula_foto(p_foto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user uuid;
  v_oficio text;
  v_path text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_foto_id IS NULL THEN
    RAISE EXCEPTION 'Falta la foto.';
  END IF;

  SELECT f.user_id, f.oficio_codigo
    INTO v_user, v_oficio
  FROM public.matricula_fotos f
  WHERE f.id = p_foto_id;

  IF NOT FOUND OR v_user IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'No encontramos esa foto.';
  END IF;

  PERFORM 1
  FROM public.matriculas m
  WHERE m.user_id = v_uid
    AND m.oficio_codigo = v_oficio
  FOR UPDATE;

  SELECT f.storage_path, f.status
    INTO v_path, v_status
  FROM public.matricula_fotos f
  WHERE f.id = p_foto_id
    AND f.user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos esa foto.';
  END IF;

  DELETE FROM public.matricula_fotos WHERE id = p_foto_id AND user_id = v_uid;
  PERFORM public._matricula_sync_paths(v_uid, v_oficio);

  RETURN jsonb_build_object(
    'id', p_foto_id,
    'storage_path', v_path,
    'oficio_codigo', v_oficio,
    'status', v_status,
    'verificada', public._oficio_verificado(v_uid, v_oficio)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_antecedentes_penales()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT jsonb_build_object(
    'status', a.status,
    'asunto', CASE WHEN a.status = 'rechazado' THEN a.rejection_reason ELSE NULL END,
    'mime_type', a.mime_type,
    'storage_path', a.storage_path,
    'updated_at', a.updated_at
  ) INTO v_row
  FROM public.antecedentes_penales a
  WHERE a.user_id = v_uid;
  RETURN v_row;
END; $function$;

CREATE OR REPLACE FUNCTION public.delete_my_antecedentes_penales()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_path text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.antecedentes_penales a
  WHERE a.user_id = v_uid
  RETURNING a.storage_path, a.status INTO v_path, v_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'storage_path', NULL);
  END IF;

  RETURN jsonb_build_object('deleted', true, 'storage_path', v_path, 'status', v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_matriculas_pendientes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  -- La app de admin ya publicada aprueba por user_id. Solo ve el legado,
  -- para no mostrar el oficio principal como si fuera el de la matrícula.
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'updated_at'), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'user_id', m.user_id,
      'nombre', coalesce(nullif(btrim(p.nombre), ''), ''),
      'apellido', coalesce(nullif(btrim(p.apellido), ''), ''),
      'oficio', 'Sin vínculo demostrable',
      'oficio_codigo', 'sin_vincular',
      'vinculo', 'sin_evidencia',
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
      AND m.oficio_codigo = 'sin_vincular'
  ) q;

  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_matriculas_revision()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      'oficio_codigo', m.oficio_codigo,
      'oficio', CASE m.oficio_codigo
        WHEN 'gas' THEN 'Gas'
        WHEN 'electricidad' THEN 'Electricidad'
        WHEN 'plomeria' THEN 'Plomería'
        WHEN 'fumigacion' THEN 'Fumigación'
        ELSE 'Sin vínculo demostrable'
      END,
      'vinculo', CASE WHEN m.oficio_codigo = 'sin_vincular' THEN 'sin_evidencia' ELSE 'oficio' END,
      'dni', coalesce(nullif(btrim(p.dni), ''), ''),
      'email', coalesce(u.email, ''),
      'numero', m.numero,
      'entidad', m.entidad,
      'status', m.status,
      'identidad_version', m.identidad_version,
      'storage_bucket', 'matriculas',
      'storage_paths', to_jsonb(m.storage_paths),
      'fotos', public._matricula_fotos_json(m.user_id, m.oficio_codigo),
      'archivo_url', NULL,
      'archivo_url_expira_en_segundos', 600,
      'updated_at', m.updated_at
    ) AS item
    FROM public.matriculas m
    JOIN public.profiles p ON p.id = m.user_id
    LEFT JOIN auth.users u ON u.id = m.user_id
    WHERE m.status = 'pendiente'
       OR EXISTS (
         SELECT 1
         FROM public.matricula_fotos f
         WHERE f.user_id = m.user_id
           AND f.oficio_codigo = m.oficio_codigo
           AND f.status = 'pendiente'
       )
  ) q;

  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_aprobar_matricula(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_status text;
  v_version integer;
  v_at timestamptz := now();
BEGIN
  v_admin := public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario.';
  END IF;

  SELECT m.status, m.identidad_version
    INTO v_status, v_version
  FROM public.matriculas m
  WHERE m.user_id = p_user_id
    AND m.oficio_codigo = 'sin_vincular'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una matrícula para este usuario.';
  END IF;
  IF v_status IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'No hay una matrícula pendiente para este usuario.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.matricula_fotos f
    WHERE f.user_id = p_user_id
      AND f.oficio_codigo = 'sin_vincular'
      AND f.status = 'pendiente'
      AND f.identidad_version = v_version
  ) THEN
    RAISE EXCEPTION 'No hay una foto nueva de esta matrícula para revisar.';
  END IF;

  UPDATE public.matriculas
  SET status = 'aprobada',
      rejection_reason = NULL,
      reviewed_at = v_at,
      reviewed_by = v_admin,
      updated_at = v_at
  WHERE user_id = p_user_id
    AND oficio_codigo = 'sin_vincular';

  UPDATE public.matricula_fotos
  SET status = 'aprobada',
      rejection_reason = NULL,
      reviewed_at = v_at,
      reviewed_by = v_admin
  WHERE user_id = p_user_id
    AND oficio_codigo = 'sin_vincular'
    AND status = 'pendiente'
    AND identidad_version = v_version;

  RETURN jsonb_build_object('user_id', p_user_id, 'status', 'aprobada', 'reviewed_at', v_at, 'oficio_codigo', 'sin_vincular');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rechazar_matricula(p_user_id uuid, p_motivo text)
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
    AND m.oficio_codigo = 'sin_vincular'
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
  WHERE user_id = p_user_id
    AND oficio_codigo = 'sin_vincular';

  UPDATE public.matricula_fotos
  SET status = 'rechazada',
      rejection_reason = v_motivo,
      reviewed_at = v_at,
      reviewed_by = v_admin
  WHERE user_id = p_user_id
    AND oficio_codigo = 'sin_vincular'
    AND status = 'pendiente'
    AND identidad_version = (
      SELECT m.identidad_version
      FROM public.matriculas m
      WHERE m.user_id = p_user_id
        AND m.oficio_codigo = 'sin_vincular'
    );

  v_event := 'matricula:' || p_user_id::text || ':' || floor(extract(epoch FROM v_at))::text;
  PERFORM public.notify_matricula_rechazo(p_user_id, v_motivo, v_event);

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status', 'rechazada',
    'motivo', v_motivo,
    'reviewed_at', v_at,
    'oficio_codigo', 'sin_vincular'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_aprobar_matricula_foto(p_foto_id uuid, p_identidad_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_user uuid;
  v_oficio text;
  v_status text;
  v_foto_version integer;
  v_lic text;
  v_version integer;
  v_at timestamptz := now();
BEGIN
  v_admin := public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_foto_id IS NULL THEN
    RAISE EXCEPTION 'Falta la foto.';
  END IF;

  SELECT f.user_id, f.oficio_codigo, f.identidad_version
    INTO v_user, v_oficio, v_foto_version
  FROM public.matricula_fotos f
  WHERE f.id = p_foto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos esa foto.';
  END IF;

  SELECT m.status, m.identidad_version
    INTO v_lic, v_version
  FROM public.matriculas m
  WHERE m.user_id = v_user
    AND m.oficio_codigo = v_oficio
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una matrícula para esa foto.';
  END IF;
  IF p_identidad_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'La revisión quedó vieja. Recargá antes de aprobar o rechazar.';
  END IF;
  IF v_lic IS DISTINCT FROM 'aprobada' THEN
    RAISE EXCEPTION 'Primero hay que aprobar la matrícula. Una foto no aprueba el número ni la entidad.';
  END IF;
  IF v_foto_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'Esa foto es de una matrícula anterior.';
  END IF;

  SELECT f.status
    INTO v_status
  FROM public.matricula_fotos f
  WHERE f.id = p_foto_id
  FOR UPDATE;
  IF v_status IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'Esa foto no está pendiente.';
  END IF;

  UPDATE public.matricula_fotos
  SET status = 'aprobada',
      rejection_reason = NULL,
      reviewed_at = v_at,
      reviewed_by = v_admin
  WHERE id = p_foto_id;

  RETURN jsonb_build_object(
    'foto_id', p_foto_id,
    'user_id', v_user,
    'oficio_codigo', v_oficio,
    'status', 'aprobada',
    'reviewed_at', v_at,
    'verificada', public._oficio_verificado(v_user, v_oficio)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rechazar_matricula_foto(p_foto_id uuid, p_motivo text, p_identidad_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_user uuid;
  v_oficio text;
  v_status text;
  v_foto_version integer;
  v_version integer;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_at timestamptz := now();
  v_event text;
BEGIN
  v_admin := public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_foto_id IS NULL THEN
    RAISE EXCEPTION 'Falta la foto.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Tenés que indicar el motivo del rechazo.';
  END IF;
  IF char_length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'El motivo puede tener hasta 300 caracteres.';
  END IF;

  SELECT f.user_id, f.oficio_codigo, f.identidad_version
    INTO v_user, v_oficio, v_foto_version
  FROM public.matricula_fotos f
  WHERE f.id = p_foto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos esa foto.';
  END IF;

  SELECT m.identidad_version
    INTO v_version
  FROM public.matriculas m
  WHERE m.user_id = v_user
    AND m.oficio_codigo = v_oficio
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una matrícula para esa foto.';
  END IF;
  IF p_identidad_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'La revisión quedó vieja. Recargá antes de aprobar o rechazar.';
  END IF;
  IF v_foto_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'Esa foto es de una matrícula anterior.';
  END IF;

  SELECT f.status
    INTO v_status
  FROM public.matricula_fotos f
  WHERE f.id = p_foto_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos esa foto.';
  END IF;
  IF v_status = 'rechazada' THEN
    RAISE EXCEPTION 'Esa foto ya está rechazada.';
  END IF;

  UPDATE public.matricula_fotos
  SET status = 'rechazada',
      rejection_reason = v_motivo,
      reviewed_at = v_at,
      reviewed_by = v_admin
  WHERE id = p_foto_id;

  v_event := 'matricula:' || v_user::text || ':' || p_foto_id::text || ':' || floor(extract(epoch FROM v_at))::text;
  PERFORM public.notify_matricula_rechazo(v_user, v_motivo, v_event);

  RETURN jsonb_build_object(
    'foto_id', p_foto_id,
    'user_id', v_user,
    'oficio_codigo', v_oficio,
    'status', 'rechazada',
    'motivo', v_motivo,
    'reviewed_at', v_at,
    'verificada', public._oficio_verificado(v_user, v_oficio)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_aprobar_matricula_oficio(
  p_user_id uuid,
  p_oficio text,
  p_identidad_version integer,
  p_foto_ids uuid[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_oficio text := lower(btrim(coalesce(p_oficio, '')));
  v_version integer;
  v_at timestamptz := now();
BEGIN
  v_admin := public._admin_require();
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario.';
  END IF;
  IF v_oficio NOT IN ('gas', 'electricidad', 'plomeria', 'fumigacion', 'sin_vincular') THEN
    RAISE EXCEPTION 'El oficio de la matrícula no es válido.';
  END IF;

  v_version := public._matricula_revision_vigente(p_user_id, v_oficio, p_identidad_version, p_foto_ids);
  IF coalesce(cardinality(p_foto_ids), 0) < 1 THEN
    RAISE EXCEPTION 'No hay una foto nueva de esta matrícula para revisar.';
  END IF;

  UPDATE public.matriculas
  SET status = 'aprobada',
      rejection_reason = NULL,
      reviewed_at = v_at,
      reviewed_by = v_admin,
      updated_at = v_at
  WHERE user_id = p_user_id
    AND oficio_codigo = v_oficio;

  UPDATE public.matricula_fotos
  SET status = 'aprobada',
      rejection_reason = NULL,
      reviewed_at = v_at,
      reviewed_by = v_admin
  WHERE user_id = p_user_id
    AND oficio_codigo = v_oficio
    AND status = 'pendiente'
    AND identidad_version = v_version;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'oficio_codigo', v_oficio,
    'status', 'aprobada',
    'reviewed_at', v_at,
    'verificada', public._oficio_verificado(p_user_id, v_oficio)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rechazar_matricula_oficio(
  p_user_id uuid,
  p_oficio text,
  p_motivo text,
  p_identidad_version integer,
  p_foto_ids uuid[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_oficio text := lower(btrim(coalesce(p_oficio, '')));
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_version integer;
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
  IF v_oficio NOT IN ('gas', 'electricidad', 'plomeria', 'fumigacion', 'sin_vincular') THEN
    RAISE EXCEPTION 'El oficio de la matrícula no es válido.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Tenés que indicar el motivo del rechazo.';
  END IF;
  IF char_length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'El motivo puede tener hasta 300 caracteres.';
  END IF;

  v_version := public._matricula_revision_vigente(p_user_id, v_oficio, p_identidad_version, p_foto_ids);

  UPDATE public.matriculas
  SET status = 'rechazada',
      rejection_reason = v_motivo,
      reviewed_at = v_at,
      reviewed_by = v_admin,
      updated_at = v_at
  WHERE user_id = p_user_id
    AND oficio_codigo = v_oficio;

  -- Solo las pendientes de esta identidad. Las aprobadas de antes quedan como estaban.
  -- El sello cae porque el status deja de ser aprobada.
  UPDATE public.matricula_fotos
  SET status = 'rechazada',
      rejection_reason = v_motivo,
      reviewed_at = v_at,
      reviewed_by = v_admin
  WHERE user_id = p_user_id
    AND oficio_codigo = v_oficio
    AND status = 'pendiente'
    AND identidad_version = v_version;

  v_event := 'matricula:' || p_user_id::text || ':' || v_oficio || ':' || floor(extract(epoch FROM v_at))::text;
  PERFORM public.notify_matricula_rechazo(p_user_id, v_motivo, v_event);

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'oficio_codigo', v_oficio,
    'status', 'rechazada',
    'motivo', v_motivo,
    'reviewed_at', v_at,
    'verificada', public._oficio_verificado(p_user_id, v_oficio)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_matriculas() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_my_matricula_oficio(text, text, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_matricula_foto(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_antecedentes_penales() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_matriculas_revision() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_aprobar_matricula_foto(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_rechazar_matricula_foto(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_aprobar_matricula_oficio(uuid, text, integer, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_rechazar_matricula_oficio(uuid, text, text, integer, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_matriculas() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_my_matricula_oficio(text, text, text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_matricula_foto(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_antecedentes_penales() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_matriculas_revision() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_aprobar_matricula_foto(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_rechazar_matricula_foto(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_aprobar_matricula_oficio(uuid, text, integer, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_rechazar_matricula_oficio(uuid, text, text, integer, uuid[]) TO authenticated, service_role;

-- Funciones públicas: mismo cuerpo vivo, solo el cálculo de matrícula y las columnas del feed.
CREATE OR REPLACE FUNCTION public.search_workers_for_client(p_client_lat double precision, p_client_lng double precision, p_query text DEFAULT ''::text, p_category_names text[] DEFAULT NULL::text[], p_exclude_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 80)
 RETURNS TABLE(profile_id uuid, nombre text, apellido text, avatar_url text, lat double precision, lng double precision, coverage_km integer, distance_km double precision, primary_trade text, all_trades text[], summary_jobs text, rating_average numeric, review_count integer, total_jobs_done integer, atiende_urgencias boolean, antecedentes_penales boolean, matricula_verificada boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
      public._matricula_publica_verificada(p.id) AS matricula_verificada
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
    'descripcion', coalesce(NULLIF(trim(coalesce(p.professional_description, '')), ''), ''),
    'antecedentes_penales', EXISTS (
      SELECT 1
      FROM public.antecedentes_penales ap
      WHERE ap.user_id = p.id
        AND ap.status = 'aprobado'
    ),
    'matricula_verificada', public._matricula_publica_verificada(p.id)
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

CREATE OR REPLACE FUNCTION public.storage_referenced_paths()
 RETURNS TABLE(bucket_id text, object_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
    UNION ALL
    SELECT 'matriculas',
           nullif(btrim(coalesce(f.storage_path, '')), '')
    FROM public.matricula_fotos f
    WHERE coalesce(f.storage_path, '') <> ''
    UNION ALL
    SELECT 'matriculas',
           nullif(btrim(coalesce(u.storage_path, '')), '')
    FROM public.matricula_paths_usados u
    WHERE coalesce(u.storage_path, '') <> ''
  ) x
  WHERE object_path IS NOT NULL AND object_path <> '';
$function$;

DROP FUNCTION IF EXISTS public.fetch_feed_posts(integer);
CREATE OR REPLACE FUNCTION public.fetch_feed_posts(p_limit integer DEFAULT 60)
 RETURNS TABLE(id uuid, worker_id uuid, trade text, description text, image_urls text[], created_at timestamp with time zone, worker_nombre text, worker_avatar_url text, worker_rating_average numeric, worker_review_count integer, worker_total_jobs_done integer, like_count bigint, liked_by_me boolean, worker_antecedentes_aprobado boolean, worker_matriculas_verificadas text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lim AS (
    SELECT least(greatest(coalesce(p_limit, 60), 1), 100) AS n
  )
  SELECT
    p.id,
    p.worker_id,
    p.trade,
    p.description,
    coalesce(p.image_urls, '{}'::text[]) AS image_urls,
    p.created_at,
    coalesce(pr.nombre, '') AS worker_nombre,
    coalesce(pr.avatar_url, '') AS worker_avatar_url,
    coalesce(pr.rating_average, 0) AS worker_rating_average,
    coalesce(pr.review_count, 0) AS worker_review_count,
    coalesce(pr.total_jobs_done, 0) AS worker_total_jobs_done,
    (SELECT count(*)::bigint FROM public.post_likes pl WHERE pl.post_id = p.id) AS like_count,
    coalesce(
      (
        SELECT true
        FROM public.post_likes pl
        WHERE pl.post_id = p.id AND pl.user_id = auth.uid()
        LIMIT 1
      ),
      false
    ) AS liked_by_me,
    public._worker_antecedentes_aprobado(p.worker_id) AS worker_antecedentes_aprobado,
    public._matriculas_oficios_verificados(p.worker_id) AS worker_matriculas_verificadas
  FROM public.posts p
  JOIN public.profiles pr ON pr.id = p.worker_id
  WHERE
    coalesce(pr.professional_status, 'none') NOT IN ('deactivated')
    AND coalesce(p.hidden_by_worker, false) = false
    AND coalesce(pr.coverage_km, 0) > 0
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.user_id = p.worker_id
      LIMIT 1
    )
    AND (
      auth.uid() IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.publicaciones_ocultas h
        WHERE h.publicacion_id = p.id
          AND h.user_id = auth.uid()
      )
    )
  ORDER BY p.created_at DESC
  LIMIT (SELECT n FROM lim);
$function$;

REVOKE ALL ON FUNCTION public.fetch_feed_posts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_feed_posts(integer) TO anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.fetch_worker_posts(uuid, integer);
CREATE OR REPLACE FUNCTION public.fetch_worker_posts(p_worker_id uuid, p_limit integer DEFAULT 60)
 RETURNS TABLE(id uuid, worker_id uuid, trade text, description text, image_urls text[], created_at timestamp with time zone, worker_nombre text, worker_avatar_url text, worker_rating_average numeric, worker_review_count integer, worker_total_jobs_done integer, like_count bigint, liked_by_me boolean, worker_antecedentes_aprobado boolean, worker_matriculas_verificadas text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lim AS (
    SELECT least(greatest(coalesce(p_limit, 60), 1), 100) AS n
  )
  SELECT
    p.id,
    p.worker_id,
    p.trade,
    p.description,
    coalesce(p.image_urls, '{}'::text[]) AS image_urls,
    p.created_at,
    coalesce(pr.nombre, '') AS worker_nombre,
    coalesce(pr.avatar_url, '') AS worker_avatar_url,
    coalesce(pr.rating_average, 0) AS worker_rating_average,
    coalesce(pr.review_count, 0) AS worker_review_count,
    coalesce(pr.total_jobs_done, 0) AS worker_total_jobs_done,
    (SELECT count(*)::bigint FROM public.post_likes pl WHERE pl.post_id = p.id) AS like_count,
    coalesce(
      (
        SELECT true
        FROM public.post_likes pl
        WHERE pl.post_id = p.id AND pl.user_id = auth.uid()
        LIMIT 1
      ),
      false
    ) AS liked_by_me,
    public._worker_antecedentes_aprobado(p.worker_id) AS worker_antecedentes_aprobado,
    public._matriculas_oficios_verificados(p.worker_id) AS worker_matriculas_verificadas
  FROM public.posts p
  JOIN public.profiles pr ON pr.id = p.worker_id
  WHERE p.worker_id = p_worker_id
    AND coalesce(p.hidden_by_worker, false) = false
    AND (
      auth.uid() IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.publicaciones_ocultas h
        WHERE h.publicacion_id = p.id
          AND h.user_id = auth.uid()
      )
    )
  ORDER BY p.created_at DESC
  LIMIT (SELECT n FROM lim);
$function$;

REVOKE ALL ON FUNCTION public.fetch_worker_posts(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_worker_posts(uuid, integer) TO anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.get_public_post(uuid);
CREATE OR REPLACE FUNCTION public.get_public_post(p_post_id uuid)
 RETURNS TABLE(id uuid, worker_id uuid, trade text, description text, image_urls text[], created_at timestamp with time zone, worker_nombre text, worker_avatar_url text, worker_rating_average numeric, worker_review_count integer, worker_total_jobs_done integer, worker_antecedentes_aprobado boolean, worker_matriculas_verificadas text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.worker_id,
    p.trade,
    p.description,
    coalesce(p.image_urls, '{}'::text[]),
    p.created_at,
    coalesce(pr.nombre, 'Profesional')::text,
    nullif(trim(coalesce(pr.avatar_url, '')), ''),
    coalesce(pr.rating_average, 0)::numeric,
    coalesce(pr.review_count, 0)::int,
    coalesce(pr.total_jobs_done, 0)::int,
    public._worker_antecedentes_aprobado(p.worker_id) AS worker_antecedentes_aprobado,
    public._matriculas_oficios_verificados(p.worker_id) AS worker_matriculas_verificadas
  FROM public.posts p
  LEFT JOIN public.profiles pr ON pr.id = p.worker_id
  WHERE p.id = p_post_id
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_public_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_post(uuid) TO anon, authenticated, service_role;
-- CREATE OR REPLACE conserva los grants de producción. El REVOKE de PUBLIC evita
-- que un alta nueva herede EXECUTE para anon por el default de Postgres.
REVOKE ALL ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_worker_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_worker_profile(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.storage_referenced_paths() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_referenced_paths() TO service_role;
REVOKE ALL ON FUNCTION public.get_my_matricula() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matricula() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_antecedentes_penales() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_antecedentes_penales() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_my_matricula(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_my_matricula(text, text, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_matriculas_pendientes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_matriculas_pendientes() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_aprobar_matricula(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_aprobar_matricula(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_rechazar_matricula(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_rechazar_matricula(uuid, text) TO authenticated, service_role;
