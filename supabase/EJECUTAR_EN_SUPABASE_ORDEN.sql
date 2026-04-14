-- =============================================================================
-- Tu Changa — ejecutar EN ESTE ORDEN en Supabase → SQL → New query → Run
-- Una sola vez por proyecto (si algo falla por "already exists", revisá abajo).
-- Requiere extensión PostGIS: Dashboard → Database → Extensions → PostGIS ON
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PARTE 1 de 3 — Esquema inicial (perfiles, jobs, chat, RLS, Realtime, storage)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;

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

CREATE OR REPLACE FUNCTION public.touch_conversation_on_message () RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;
CREATE TRIGGER trg_messages_touch_conversation
AFTER INSERT ON public.messages FOR EACH ROW
EXECUTE FUNCTION public.touch_conversation_on_message ();

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
    id, nombre, apellido, dni, telefono, direccion_texto, location, avatar_url, coverage_km
  )
  VALUES (
    auth.uid (),
    p_nombre, p_apellido, p_dni, p_telefono, p_direccion,
    ST_SetSRID (ST_MakePoint (p_lng, p_lat), 4326)::geography,
    NULLIF (trim(p_avatar_url), ''),
    p_coverage_km
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.insert_profile_with_location (
  TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, INTEGER
) TO authenticated;

-- find_or_create_conversation: solo en Parte 3 (evita 42P13 al cambiar DEFAULT del 2.º parámetro).

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Re-ejecutable: si ya corriste el script antes, sin DROP falla con "policy already exists".
DROP POLICY IF EXISTS "profiles_select_auth" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

DROP POLICY IF EXISTS "jobs_select_auth" ON public.jobs;
DROP POLICY IF EXISTS "jobs_insert_own" ON public.jobs;
DROP POLICY IF EXISTS "jobs_update_own" ON public.jobs;
DROP POLICY IF EXISTS "jobs_delete_own" ON public.jobs;

DROP POLICY IF EXISTS "conv_select_participant" ON public.conversations;
DROP POLICY IF EXISTS "conv_insert_client" ON public.conversations;

DROP POLICY IF EXISTS "msg_select_participant" ON public.messages;
DROP POLICY IF EXISTS "msg_insert_participant" ON public.messages;

CREATE POLICY "profiles_select_auth" ON public.profiles FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid ());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid ());

CREATE POLICY "jobs_select_auth" ON public.jobs FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "jobs_insert_own" ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid ());
CREATE POLICY "jobs_update_own" ON public.jobs FOR UPDATE TO authenticated USING (user_id = auth.uid ());
CREATE POLICY "jobs_delete_own" ON public.jobs FOR DELETE TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "conv_select_participant" ON public.conversations FOR SELECT TO authenticated USING (
  cliente_id = auth.uid () OR trabajador_id = auth.uid ()
);
CREATE POLICY "conv_insert_client" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (cliente_id = auth.uid ());

CREATE POLICY "msg_select_participant" ON public.messages FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.cliente_id = auth.uid () OR c.trabajador_id = auth.uid ())
  )
);
CREATE POLICY "msg_insert_participant" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid ()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.cliente_id = auth.uid () OR c.trabajador_id = auth.uid ())
    )
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', TRUE), ('job-photos', 'job-photos', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_select_public" ON storage.objects;
DROP POLICY IF EXISTS "job_photos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "job_photos_select_public" ON storage.objects;

CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars' AND (storage.foldername (name)) [1] = auth.uid ()::text
  );
CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'avatars' AND (storage.foldername (name)) [1] = auth.uid ()::text
);
CREATE POLICY "avatars_select_public" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars');

CREATE POLICY "job_photos_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos' AND (storage.foldername (name)) [1] = auth.uid ()::text
  );
CREATE POLICY "job_photos_select_public" ON storage.objects FOR SELECT TO public USING (bucket_id = 'job-photos');

-- Realtime: no falla si la tabla ya estaba en la publicación.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%already member%' OR SQLERRM LIKE '%already a member%' THEN
      NULL;
    ELSE
      RAISE;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- PARTE 2 de 3 — RPC actualizar geo / cobertura del perfil
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_profile_geo_coverage (
  p_direccion TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_coverage_km INTEGER
) RETURNS VOID AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    direccion_texto = trim(p_direccion),
    location = ST_SetSRID (ST_MakePoint (p_lng, p_lat), 4326)::geography,
    coverage_km = p_coverage_km,
    updated_at = now()
  WHERE id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.update_profile_geo_coverage (
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER
) TO authenticated;

-- ---------------------------------------------------------------------------
-- PARTE 3 de 3 — Índices chat + RPC endurecido + limpieza duplicados (opcional)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_conversations_cliente ON public.conversations (cliente_id);
CREATE INDEX IF NOT EXISTS idx_conversations_trabajador ON public.conversations (trabajador_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON public.conversations (updated_at DESC);

-- PG no permite que CREATE OR REPLACE quite/ponga DEFAULT en un parámetro ya existente (42P13).
DROP FUNCTION IF EXISTS public.find_or_create_conversation(uuid, text);

CREATE OR REPLACE FUNCTION public.find_or_create_conversation(
  p_trabajador_id uuid,
  p_primary_trade text default ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid := auth.uid();
  v_id uuid;
  v_trade text;
BEGIN
  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF v_cliente_id = p_trabajador_id THEN
    RAISE EXCEPTION 'invalid_peer';
  END IF;

  v_trade := NULLIF(trim(COALESCE(p_primary_trade, '')), '');

  SELECT c.id INTO v_id
  FROM public.conversations c
  WHERE c.cliente_id = v_cliente_id AND c.trabajador_id = p_trabajador_id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (cliente_id, trabajador_id, primary_trade, updated_at)
  VALUES (v_cliente_id, p_trabajador_id, v_trade, now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_conversation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, text) TO authenticated;

DROP TRIGGER IF EXISTS trg_messages_bump_conversation ON public.messages;
DROP FUNCTION IF EXISTS public.bump_conversation_on_message();

CREATE OR REPLACE FUNCTION public.touch_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;
CREATE TRIGGER trg_messages_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_conversation_on_message();

DROP POLICY IF EXISTS "conversations_select_participant" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_as_cliente" ON public.conversations;
DROP POLICY IF EXISTS "messages_select_in_my_conversations" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_as_participant" ON public.messages;
