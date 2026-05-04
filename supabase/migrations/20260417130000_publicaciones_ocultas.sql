-- Ocultar publicaciones por usuario (no borra, solo oculta para ese usuario)

create table if not exists public.publicaciones_ocultas (
  publicacion_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (publicacion_id, user_id)
);

create index if not exists idx_publicaciones_ocultas_user on public.publicaciones_ocultas (user_id);
create index if not exists idx_publicaciones_ocultas_post on public.publicaciones_ocultas (publicacion_id);

alter table public.publicaciones_ocultas enable row level security;

drop policy if exists "pub_ocultas_select_own" on public.publicaciones_ocultas;
create policy "pub_ocultas_select_own" on public.publicaciones_ocultas
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "pub_ocultas_insert_own" on public.publicaciones_ocultas;
create policy "pub_ocultas_insert_own" on public.publicaciones_ocultas
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "pub_ocultas_delete_own" on public.publicaciones_ocultas;
create policy "pub_ocultas_delete_own" on public.publicaciones_ocultas
for delete to authenticated
using (user_id = auth.uid());

-- RPC: ocultar publicación para el usuario actual
create or replace function public.hide_post(p_publicacion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_publicacion_id is null then
    raise exception 'missing publicacion_id';
  end if;

  insert into public.publicaciones_ocultas (publicacion_id, user_id, hidden_at)
  values (p_publicacion_id, uid, now())
  on conflict (publicacion_id, user_id)
  do update set hidden_at = excluded.hidden_at;
end;
$$;

revoke all on function public.hide_post(uuid) from public;
grant execute on function public.hide_post(uuid) to authenticated;

-- RPC: feed filtrado por ocultos (evita post-procesado en frontend)
create or replace function public.fetch_feed_posts(p_limit int default 60)
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
  order by p.created_at desc
  limit (select n from lim);
$$;

revoke all on function public.fetch_feed_posts(int) from public;
grant execute on function public.fetch_feed_posts(int) to authenticated;
grant execute on function public.fetch_feed_posts(int) to anon;

