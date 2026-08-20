-- Filtrar publicaciones ocultas (por el viewer) en el perfil del profesional.
-- Misma lógica que fetch_feed_posts.

CREATE OR REPLACE FUNCTION public.fetch_worker_posts(p_worker_id uuid, p_limit int DEFAULT 60)
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
$$;

REVOKE ALL ON FUNCTION public.fetch_worker_posts(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_worker_posts(uuid, int) TO authenticated, anon;
