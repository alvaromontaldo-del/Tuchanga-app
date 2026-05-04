-- Feed: publicaciones de trabajos realizados.
-- Minimal viable schema para persistir "Publicar" desde la app.

CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  trade TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_urls TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_worker_id ON public.posts (worker_id);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Feed público (para buscar/ver trabajos sin login).
DROP POLICY IF EXISTS "posts_select_public" ON public.posts;
CREATE POLICY "posts_select_public" ON public.posts FOR SELECT TO public USING (TRUE);

-- Insertar solo tus propias publicaciones.
DROP POLICY IF EXISTS "posts_insert_own" ON public.posts;
CREATE POLICY "posts_insert_own" ON public.posts FOR INSERT TO authenticated
WITH CHECK (worker_id = auth.uid ());

DROP POLICY IF EXISTS "posts_update_own" ON public.posts;
CREATE POLICY "posts_update_own" ON public.posts FOR UPDATE TO authenticated
USING (worker_id = auth.uid ());

DROP POLICY IF EXISTS "posts_delete_own" ON public.posts;
CREATE POLICY "posts_delete_own" ON public.posts FOR DELETE TO authenticated
USING (worker_id = auth.uid ());
