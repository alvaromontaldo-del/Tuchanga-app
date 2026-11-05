CREATE EXTENSION IF NOT EXISTS postgis;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  metadata jsonb
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  nombre text,
  apellido text,
  dni text,
  avatar_url text,
  intro_video_path text,
  rating_average numeric,
  review_count integer,
  total_jobs_done integer,
  professional_status text,
  coverage_km integer,
  direccion_texto text,
  professional_description text,
  location geography(Point, 4326),
  atiende_urgencias boolean,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  nombre_oficio text,
  descripcion text,
  years_experience integer,
  es_principal boolean,
  created_at timestamptz DEFAULT now(),
  foto_url text,
  photo_urls text[]
);

CREATE TABLE public.matriculas (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  numero text NOT NULL,
  entidad text NOT NULL,
  storage_paths text[] NOT NULL,
  status text NOT NULL,
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matriculas_status_chk CHECK (status = ANY (ARRAY['pendiente','aprobada','rechazada'])),
  CONSTRAINT matriculas_numero_chk CHECK (char_length(numero) BETWEEN 1 AND 40 AND numero = btrim(numero)),
  CONSTRAINT matriculas_entidad_chk CHECK (char_length(entidad) BETWEEN 2 AND 80 AND entidad = btrim(entidad) AND entidad !~ '[[:cntrl:]]'),
  CONSTRAINT matriculas_rechazo_chk CHECK (status <> 'rechazada' OR (rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '' AND char_length(rejection_reason) <= 300))
);

CREATE TABLE public.antecedentes_penales (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  status text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid REFERENCES public.profiles(id),
  trade text,
  description text,
  image_urls text[],
  created_at timestamptz DEFAULT now(),
  hidden_by_worker boolean DEFAULT false
);
CREATE TABLE public.post_likes (
  post_id uuid,
  user_id uuid
);
CREATE TABLE public.publicaciones_ocultas (
  publicacion_id uuid,
  user_id uuid
);
CREATE TABLE public.worker_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid,
  client_id uuid,
  rating integer,
  comment text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.contrataciones (
  worker_id uuid,
  precio_trabajador numeric,
  finalizado_at timestamptz,
  estado_trabajo text,
  estado_pago text
);
CREATE TABLE public.material_requests (
  professional_id uuid,
  status text
);
CREATE TABLE public.professional_trades (
  name text,
  active boolean
);
CREATE TABLE public.stores (
  avatar_url text
);
CREATE TABLE public.messages (
  body text,
  type text
);
CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY
);
CREATE TABLE public.notify_log (
  id bigserial PRIMARY KEY,
  user_id uuid,
  motivo text,
  event_key text
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public._admin_require()
RETURNS uuid
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.search_fold(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
    lower(translate(coalesce(p_text, ''),
      'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÇçÑ',
      'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccñ')),
    '[^a-z0-9ñ]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.trade_names_for_query(p_text text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT '{}'::text[]; $$;

CREATE OR REPLACE FUNCTION public.trade_allows_materials_list(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT false; $$;

CREATE OR REPLACE FUNCTION public.storage_path_from_url(p_url text, p_bucket text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT NULL::text; $$;

CREATE OR REPLACE FUNCTION public.chat_image_storage_bucket(p_body text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT NULL::text; $$;

CREATE OR REPLACE FUNCTION public.chat_image_storage_path(p_body text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT NULL::text; $$;

CREATE OR REPLACE FUNCTION public.notify_matricula_rechazo(p_user_id uuid, p_motivo text, p_event_key text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.notify_log(user_id, motivo, event_key)
  VALUES (p_user_id, p_motivo, p_event_key);
END;
$$;

CREATE OR REPLACE FUNCTION public._matricula_paths_ok(p_user_id uuid, p_paths text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT true; $$;

ALTER TABLE public.matriculas
  ADD CONSTRAINT matriculas_paths_chk CHECK (public._matricula_paths_ok(user_id, storage_paths));

-- Reproduce el default de Supabase: authenticated hereda DML y TRUNCATE.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
