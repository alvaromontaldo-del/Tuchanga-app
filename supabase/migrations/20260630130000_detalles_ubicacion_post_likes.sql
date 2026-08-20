-- Detalles opcionales de ubicación del cliente + likes persistentes en publicaciones.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS detalles_ubicacion TEXT;

COMMENT ON COLUMN public.profiles.detalles_ubicacion IS
  'Referencias opcionales para ubicar el domicilio (ej. rejas negras, pared azul).';

DROP FUNCTION IF EXISTS public.obtener_direccion_cliente(uuid);

CREATE FUNCTION public.obtener_direccion_cliente(p_contratacion_id uuid)
RETURNS TABLE (
  direccion_texto text,
  detalles_ubicacion text,
  lat double precision,
  lng double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contrataciones%rowtype;
BEGIN
  v_row := public._assert_contratacion_participante(p_contratacion_id);

  IF v_row.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solo el trabajador puede ver la dirección';
  END IF;

  IF v_row.estado_pago NOT IN ('seña_pagada', 'totalmente_pagado') THEN
    RAISE EXCEPTION 'Dirección no disponible hasta pagar la seña';
  END IF;

  IF v_row.fecha_trabajo IS NULL OR v_row.estado_trabajo NOT IN (
    'aceptado', 'en_curso', 'pendiente_pago_diferencia', 'finalizado', 'disputa'
  ) THEN
    RAISE EXCEPTION 'Agenda no confirmada';
  END IF;

  RETURN QUERY
  SELECT
    p.direccion_texto,
    NULLIF(trim(p.detalles_ubicacion), ''),
    ST_Y(p.location::geometry)::double precision,
    ST_X(p.location::geometry)::double precision
  FROM public.profiles p
  WHERE p.id = v_row.client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_direccion_cliente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_direccion_cliente(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Likes en publicaciones
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id UUID NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_user ON public.post_likes (user_id);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_likes_select ON public.post_likes;
CREATE POLICY post_likes_select
ON public.post_likes
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS post_likes_insert_own ON public.post_likes;
CREATE POLICY post_likes_insert_own
ON public.post_likes
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS post_likes_delete_own ON public.post_likes;
CREATE POLICY post_likes_delete_own
ON public.post_likes
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON TABLE public.post_likes TO authenticated;
GRANT ALL ON TABLE public.post_likes TO service_role;

CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid)
RETURNS TABLE (liked boolean, like_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = p_post_id) THEN
    RAISE EXCEPTION 'post not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.post_likes
    WHERE post_id = p_post_id AND user_id = v_uid
  ) THEN
    DELETE FROM public.post_likes
    WHERE post_id = p_post_id AND user_id = v_uid;

    RETURN QUERY
    SELECT
      false,
      (SELECT count(*)::bigint FROM public.post_likes pl WHERE pl.post_id = p_post_id);
    RETURN;
  END IF;

  INSERT INTO public.post_likes (post_id, user_id)
  VALUES (p_post_id, v_uid);

  RETURN QUERY
  SELECT
    true,
    (SELECT count(*)::bigint FROM public.post_likes pl WHERE pl.post_id = p_post_id);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_post_like(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_post_like(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fetch_feed_posts(int);

CREATE FUNCTION public.fetch_feed_posts(p_limit int DEFAULT 60)
RETURNS TABLE (
  id uuid,
  worker_id uuid,
  trade text,
  description text,
  image_urls text[],
  created_at timestamptz,
  worker_nombre text,
  worker_avatar_url text,
  worker_rating_average numeric,
  worker_review_count int,
  like_count bigint,
  liked_by_me boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    (SELECT count(*)::bigint FROM public.post_likes pl WHERE pl.post_id = p.id) AS like_count,
    coalesce(
      (
        SELECT true
        FROM public.post_likes pl
        WHERE pl.post_id = p.id AND pl.user_id = auth.uid()
        LIMIT 1
      ),
      false
    ) AS liked_by_me
  FROM public.posts p
  JOIN public.profiles pr ON pr.id = p.worker_id
  WHERE
    coalesce(pr.coverage_km, 0) > 0
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.user_id = p.worker_id
      LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.publicaciones_ocultas h
      WHERE h.publicacion_id = p.id
        AND h.user_id = auth.uid()
    )
  ORDER BY p.created_at DESC
  LIMIT (SELECT n FROM lim);
$$;

REVOKE ALL ON FUNCTION public.fetch_feed_posts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_feed_posts(int) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.fetch_worker_posts(uuid, int);

CREATE FUNCTION public.fetch_worker_posts(p_worker_id uuid, p_limit int DEFAULT 60)
RETURNS TABLE (
  id uuid,
  worker_id uuid,
  trade text,
  description text,
  image_urls text[],
  created_at timestamptz,
  worker_nombre text,
  worker_avatar_url text,
  worker_rating_average numeric,
  worker_review_count int,
  like_count bigint,
  liked_by_me boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    (SELECT count(*)::bigint FROM public.post_likes pl WHERE pl.post_id = p.id) AS like_count,
    coalesce(
      (
        SELECT true
        FROM public.post_likes pl
        WHERE pl.post_id = p.id AND pl.user_id = auth.uid()
        LIMIT 1
      ),
      false
    ) AS liked_by_me
  FROM public.posts p
  JOIN public.profiles pr ON pr.id = p.worker_id
  WHERE
    p.worker_id = p_worker_id
    AND coalesce(pr.coverage_km, 0) > 0
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.user_id = p.worker_id
      LIMIT 1
    )
  ORDER BY p.created_at DESC
  LIMIT (SELECT n FROM lim);
$$;

REVOKE ALL ON FUNCTION public.fetch_worker_posts(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_worker_posts(uuid, int) TO authenticated, anon;
