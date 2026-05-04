-- Tu Changa — visibilidad de posts basada en "perfil profesional activo"
-- Objetivo: ocultar publicaciones cuando el perfil está dado de baja, pero que vuelvan a aparecer
-- automáticamente al reactivarlo, sin actualizar filas de public.posts.
--
-- Criterio de "activo":
-- - profiles.coverage_km > 0
-- - existe al menos 1 job (oficio) en public.jobs para ese user_id
--
-- Nota: seguimos respetando "publicaciones_ocultas" por usuario (hide_post).

drop function if exists public.fetch_feed_posts(int);

create function public.fetch_feed_posts(p_limit int default 60)
returns table (
  id uuid,
  worker_id uuid,
  trade text,
  description text,
  image_urls text[],
  created_at timestamptz,
  worker_nombre text,
  worker_avatar_url text,
  worker_rating_average numeric,
  worker_review_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with lim as (
    select least(greatest(coalesce(p_limit, 60), 1), 100) as n
  )
  select
    p.id,
    p.worker_id,
    p.trade,
    p.description,
    coalesce(p.image_urls, '{}'::text[]) as image_urls,
    p.created_at,
    coalesce(pr.nombre, '') as worker_nombre,
    coalesce(pr.avatar_url, '') as worker_avatar_url,
    coalesce(pr.rating_average, 0) as worker_rating_average,
    coalesce(pr.review_count, 0) as worker_review_count
  from public.posts p
  join public.profiles pr on pr.id = p.worker_id
  where
    -- Solo profesionales "activos"
    coalesce(pr.coverage_km, 0) > 0
    and exists (
      select 1
      from public.jobs j
      where j.user_id = p.worker_id
      limit 1
    )
    -- Respetar ocultos por usuario (si no hay auth.uid(), no filtra)
    and not exists (
      select 1
      from public.publicaciones_ocultas h
      where h.publicacion_id = p.id
        and h.user_id = auth.uid()
    )
  order by p.created_at desc
  limit (select n from lim);
$$;

revoke all on function public.fetch_feed_posts(int) from public;
grant execute on function public.fetch_feed_posts(int) to authenticated;
grant execute on function public.fetch_feed_posts(int) to anon;

-- RPC: posts de un trabajador (galería / "mis publicaciones" / perfil)
drop function if exists public.fetch_worker_posts(uuid, int);

create function public.fetch_worker_posts(p_worker_id uuid, p_limit int default 60)
returns table (
  id uuid,
  worker_id uuid,
  trade text,
  description text,
  image_urls text[],
  created_at timestamptz,
  worker_nombre text,
  worker_avatar_url text,
  worker_rating_average numeric,
  worker_review_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with lim as (
    select least(greatest(coalesce(p_limit, 60), 1), 100) as n
  )
  select
    p.id,
    p.worker_id,
    p.trade,
    p.description,
    coalesce(p.image_urls, '{}'::text[]) as image_urls,
    p.created_at,
    coalesce(pr.nombre, '') as worker_nombre,
    coalesce(pr.avatar_url, '') as worker_avatar_url,
    coalesce(pr.rating_average, 0) as worker_rating_average,
    coalesce(pr.review_count, 0) as worker_review_count
  from public.posts p
  join public.profiles pr on pr.id = p.worker_id
  where
    p.worker_id = p_worker_id
    and coalesce(pr.coverage_km, 0) > 0
    and exists (
      select 1
      from public.jobs j
      where j.user_id = p.worker_id
      limit 1
    )
  order by p.created_at desc
  limit (select n from lim);
$$;

revoke all on function public.fetch_worker_posts(uuid, int) from public;
grant execute on function public.fetch_worker_posts(uuid, int) to authenticated;
grant execute on function public.fetch_worker_posts(uuid, int) to anon;

