-- Tu Changa — actualizar fetch_feed_posts (cambio de return type)
-- PostgreSQL no permite cambiar RETURNS TABLE con create or replace.

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
  left join public.profiles pr on pr.id = p.worker_id
  where not exists (
    select 1
    from public.publicaciones_ocultas h
    where h.publicacion_id = p.id
      and h.user_id = auth.uid()
  )
    and coalesce(p.hidden_by_worker, false) = false
  order by p.created_at desc
  limit (select n from lim);
$$;

revoke all on function public.fetch_feed_posts(int) from public;
grant execute on function public.fetch_feed_posts(int) to authenticated;
grant execute on function public.fetch_feed_posts(int) to anon;

