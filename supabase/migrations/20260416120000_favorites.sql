-- Favoritos: usuario (auth.uid) ↔ profesional (profiles.id)

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  professional_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_unique_pair unique (user_id, professional_id)
);

create index if not exists idx_favorites_user_id on public.favorites (user_id, created_at desc);
create index if not exists idx_favorites_professional_id on public.favorites (professional_id);

alter table public.favorites enable row level security;

create policy "favorites_select_own" on public.favorites
for select to authenticated
using (user_id = auth.uid());

create policy "favorites_insert_own" on public.favorites
for insert to authenticated
with check (user_id = auth.uid());

create policy "favorites_delete_own" on public.favorites
for delete to authenticated
using (user_id = auth.uid());

-- RPC: POST /favorites/toggle
create or replace function public.toggle_favorite(p_professional_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_professional_id is null then
    raise exception 'missing professional_id';
  end if;

  if exists (
    select 1
    from public.favorites f
    where f.user_id = auth.uid()
      and f.professional_id = p_professional_id
  ) then
    delete from public.favorites f
    where f.user_id = auth.uid()
      and f.professional_id = p_professional_id;
    return false;
  end if;

  insert into public.favorites (user_id, professional_id)
  values (auth.uid(), p_professional_id)
  on conflict (user_id, professional_id) do nothing;

  return true;
end;
$$;

revoke all on function public.toggle_favorite(uuid) from public;
grant execute on function public.toggle_favorite(uuid) to authenticated;

-- RPC: GET /favorites (detalle de profesionales)
create or replace function public.list_favorites()
returns table (
  profile_id uuid,
  nombre text,
  apellido text,
  avatar_url text,
  primary_trade text,
  all_trades text[],
  summary_jobs text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      p.id as profile_id,
      p.nombre,
      p.apellido,
      p.avatar_url,
      (
        select j2.nombre_oficio
        from public.jobs j2
        where j2.user_id = p.id
        order by j2.es_principal desc, j2.created_at
        limit 1
      ) as primary_trade,
      coalesce(
        (
          select array_agg(j3.nombre_oficio order by j3.nombre_oficio)
          from public.jobs j3
          where j3.user_id = p.id
        ),
        '{}'::text[]
      ) as all_trades,
      (
        select string_agg(x.nombre_oficio || ': ' || left(coalesce(x.descripcion, ''), 100), ' · ' order by x.ord)
        from (
          select j.nombre_oficio, j.descripcion, row_number() over (order by j.es_principal desc, j.created_at) as ord
          from public.jobs j
          where j.user_id = p.id
        ) x
        where x.ord <= 3
      ) as summary_jobs,
      f.created_at
    from public.favorites f
    join public.profiles p on p.id = f.professional_id
    where f.user_id = auth.uid()
  )
  select
    b.profile_id,
    b.nombre,
    b.apellido,
    b.avatar_url,
    b.primary_trade,
    b.all_trades,
    b.summary_jobs
  from base b
  order by b.created_at desc;
$$;

revoke all on function public.list_favorites() from public;
grant execute on function public.list_favorites() to authenticated;

