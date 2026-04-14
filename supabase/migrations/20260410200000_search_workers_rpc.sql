-- Búsqueda de trabajadores: cobertura con ST_DWithin (distancia desde base del trabajador al punto cliente ≤ coverage_km).

create or replace function public.search_workers_for_client(
  p_client_lat double precision,
  p_client_lng double precision,
  p_query text default '',
  p_category_names text[] default null,
  p_exclude_user_id uuid default null,
  p_limit int default 80
)
returns table (
  profile_id uuid,
  nombre text,
  apellido text,
  avatar_url text,
  lat double precision,
  lng double precision,
  coverage_km int,
  distance_km double precision,
  primary_trade text,
  all_trades text[],
  summary_jobs text
)
language sql
stable
security definer
set search_path = public
as $$
  with client_pt as (
    select st_setsrid(st_makepoint(p_client_lng, p_client_lat), 4326)::geography as g
  ),
  lim as (
    select least(greatest(coalesce(p_limit, 80), 1), 100) as n
  ),
  base as (
    select
      p.id as profile_id,
      p.nombre,
      p.apellido,
      p.avatar_url,
      st_y(p.location::geometry) as lat,
      st_x(p.location::geometry) as lng,
      p.coverage_km,
      st_distance(p.location, (select g from client_pt), false) / 1000.0 as distance_km,
      (
        select j2.nombre_oficio
        from jobs j2
        where j2.user_id = p.id
        order by j2.es_principal desc, j2.created_at
        limit 1
      ) as primary_trade,
      coalesce(
        (
          select array_agg(j3.nombre_oficio order by j3.nombre_oficio)
          from jobs j3
          where j3.user_id = p.id
        ),
        '{}'::text[]
      ) as all_trades,
      (
        select string_agg(x.nombre_oficio || ': ' || left(coalesce(x.descripcion, ''), 100), ' · ' order by x.ord)
        from (
          select j.nombre_oficio, j.descripcion, row_number() over (order by j.es_principal desc, j.created_at) as ord
          from jobs j
          where j.user_id = p.id
        ) x
        where x.ord <= 3
      ) as summary_jobs
    from profiles p
    where p.coverage_km is not null
      and p.coverage_km > 0
      and exists (select 1 from jobs j where j.user_id = p.id)
      and (p_exclude_user_id is null or p.id <> p_exclude_user_id)
      and st_dwithin(p.location, (select g from client_pt), p.coverage_km * 1000.0)
  )
  select b.*
  from base b
  where (
      coalesce(trim(p_query), '') = ''
      or b.nombre ilike '%' || trim(p_query) || '%'
      or b.apellido ilike '%' || trim(p_query) || '%'
      or exists (
        select 1
        from jobs j
        where j.user_id = b.profile_id
          and (
            j.nombre_oficio ilike '%' || trim(p_query) || '%'
            or j.descripcion ilike '%' || trim(p_query) || '%'
          )
      )
    )
    and (
      p_category_names is null
      or coalesce(array_length(p_category_names, 1), 0) = 0
      or b.all_trades && p_category_names
    )
  order by b.distance_km asc
  limit (select n from lim);
$$;

revoke all on function public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) from public;
grant execute on function public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) to authenticated;
grant execute on function public.search_workers_for_client(double precision, double precision, text, text[], uuid, int) to anon;
