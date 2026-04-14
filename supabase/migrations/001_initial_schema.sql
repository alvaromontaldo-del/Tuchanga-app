-- Tu Changa — esquema inicial (ejecutar en Supabase SQL Editor o CLI)
-- Requiere proyecto Supabase con PostGIS disponible.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Perfiles (1:1 con auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  dni TEXT NOT NULL,
  telefono TEXT NOT NULL,
  direccion_texto TEXT NOT NULL,
  location GEOGRAPHY (POINT, 4326) NOT NULL,
  avatar_url TEXT,
  coverage_km INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Oficios del usuario (registro trabajador)
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  nombre_oficio TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  foto_url TEXT,
  es_principal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON public.jobs (user_id);

-- Chat
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  cliente_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  trabajador_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  primary_trade TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversations_distinct_participants CHECK (cliente_id <> trabajador_id),
  CONSTRAINT conversations_unique_pair UNIQUE (cliente_id, trabajador_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'budget')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages (conversation_id, created_at DESC);

-- Actualizar conversación al llegar mensaje
CREATE OR REPLACE FUNCTION public.touch_conversation_on_message () RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET
    updated_at = now()
  WHERE
    id = NEW.conversation_id;

  RETURN NEW;

END;

$$ LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public;

DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;

-- PG14+: EXECUTE FUNCTION; si falla, probá EXECUTE PROCEDURE touch_conversation_on_message();
CREATE TRIGGER trg_messages_touch_conversation
AFTER INSERT ON public.messages FOR EACH ROW
EXECUTE FUNCTION public.touch_conversation_on_message ();

-- RPC: perfil + punto geográfico (lng/lat en WGS84)
CREATE OR REPLACE FUNCTION public.insert_profile_with_location (
  p_nombre TEXT,
  p_apellido TEXT,
  p_dni TEXT,
  p_telefono TEXT,
  p_direccion TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_avatar_url TEXT,
  p_coverage_km INTEGER
) RETURNS VOID AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.profiles (
    id,
    nombre,
    apellido,
    dni,
    telefono,
    direccion_texto,
    location,
    avatar_url,
    coverage_km
  )
  VALUES (
    auth.uid (),
    p_nombre,
    p_apellido,
    p_dni,
    p_telefono,
    p_direccion,
    ST_SetSRID (ST_MakePoint (p_lng, p_lat), 4326)::geography,
    NULLIF (trim(p_avatar_url), ''),
    p_coverage_km
  );

END;

$$ LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public;

GRANT EXECUTE ON FUNCTION public.insert_profile_with_location (
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT,
  INTEGER
) TO authenticated;

-- RPC: conversación cliente ↔ trabajador (2.º parámetro con DEFAULT para coincidir con migraciones posteriores)
CREATE OR REPLACE FUNCTION public.find_or_create_conversation (
  p_trabajador_id UUID,
  p_primary_trade TEXT DEFAULT ''
) RETURNS UUID AS $$
DECLARE
  conv_id UUID;

BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_trabajador_id = auth.uid () THEN
    RAISE EXCEPTION 'invalid participants';
  END IF;

  SELECT
    c.id INTO conv_id
  FROM
    public.conversations c
  WHERE
    c.cliente_id = auth.uid ()
    AND c.trabajador_id = p_trabajador_id
  LIMIT
    1;

  IF conv_id IS NOT NULL THEN
    RETURN conv_id;
  END IF;

  INSERT INTO public.conversations (cliente_id, trabajador_id, primary_trade)
  VALUES (
    auth.uid (),
    p_trabajador_id,
    NULLIF (trim(COALESCE(p_primary_trade, '')), '')
  )
RETURNING
  id INTO conv_id;

  RETURN conv_id;

END;

$$ LANGUAGE plpgsql SECURITY DEFINER
SET
  search_path = public;

GRANT EXECUTE ON FUNCTION public.find_or_create_conversation (UUID, TEXT) TO authenticated;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_auth" ON public.profiles FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated
WITH
  CHECK (id = auth.uid ());

CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid ());

CREATE POLICY "jobs_select_auth" ON public.jobs FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "jobs_insert_own" ON public.jobs FOR INSERT TO authenticated
WITH
  CHECK (user_id = auth.uid ());

CREATE POLICY "jobs_update_own" ON public.jobs FOR UPDATE TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "jobs_delete_own" ON public.jobs FOR DELETE TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "conv_select_participant" ON public.conversations FOR SELECT TO authenticated USING (
  cliente_id = auth.uid ()
  OR trabajador_id = auth.uid ()
);

CREATE POLICY "conv_insert_client" ON public.conversations FOR INSERT TO authenticated
WITH
  CHECK (cliente_id = auth.uid ());

CREATE POLICY "msg_select_participant" ON public.messages FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.conversations c
    WHERE
      c.id = conversation_id
      AND (
        c.cliente_id = auth.uid ()
        OR c.trabajador_id = auth.uid ()
      )
  )
);

CREATE POLICY "msg_insert_participant" ON public.messages FOR INSERT TO authenticated
WITH
  CHECK (
    sender_id = auth.uid ()
    AND EXISTS (
      SELECT
        1
      FROM
        public.conversations c
      WHERE
        c.id = conversation_id
        AND (
          c.cliente_id = auth.uid ()
          OR c.trabajador_id = auth.uid ()
        )
    )
  );

-- Storage: buckets (Supabase exige columna `name` además de `id`)
INSERT INTO
  storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', TRUE),
  ('job-photos', 'job-photos', TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH
  CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername (name)) [1] = auth.uid ()::text
  );

CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'avatars'
  AND (storage.foldername (name)) [1] = auth.uid ()::text
);

CREATE POLICY "avatars_select_public" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars');

CREATE POLICY "job_photos_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH
  CHECK (
    bucket_id = 'job-photos'
    AND (storage.foldername (name)) [1] = auth.uid ()::text
  );

CREATE POLICY "job_photos_select_public" ON storage.objects FOR SELECT TO public USING (bucket_id = 'job-photos');

-- Realtime: nuevos mensajes (si ya existe, ignorá el error del editor)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
