-- Card #210: estadísticas de gestión del comercio (solo comercios del owner).
create or replace function public.get_store_stats(p_from date, p_to date)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_to timestamptz;
  v_result json;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'range_too_long' using errcode = '22023';
  end if;
  -- Días en hora Argentina, fin exclusivo.
  v_from := (p_from::timestamp) at time zone 'America/Argentina/Buenos_Aires';
  v_to := ((p_to + 1)::timestamp) at time zone 'America/Argentina/Buenos_Aires';

  with my_stores as (
    select s.id from stores s where s.user_id = v_uid
  ),
  sales as (
    select o.id, o.quote_id, coalesce(o.accepted_total, 0)::numeric as total
    from orders o
    join quotes q on q.id = o.quote_id
    where q.store_id in (select id from my_stores)
      and o.status = 'completed'
      and o.completed_at >= v_from and o.completed_at < v_to
  ),
  sent as (
    select q.id, q.status
    from quotes q
    where q.store_id in (select id from my_stores)
      and q.created_at >= v_from and q.created_at < v_to
  ),
  sent_closed as (
    select count(*) n from sent s
    where exists (select 1 from orders o where o.quote_id = s.id and o.status = 'completed')
  ),
  top as (
    select ri.description, ri.unit, sum(ri.quantity) qty, count(distinct s.id) sales
    from sales s
    join quote_items qi on qi.quote_id = s.quote_id and qi.client_decision = 'accepted'
    join request_items ri on ri.id = qi.request_item_id
    group by 1, 2
    order by sales desc, qty desc, ri.description
    limit 5
  )
  select json_build_object(
    'from', p_from,
    'to', p_to,
    'has_store', exists (select 1 from my_stores),
    'earnings', (select coalesce(sum(total), 0) from sales),
    'sales_count', (select count(*) from sales),
    'avg_ticket', (select coalesce(round(avg(total)), 0) from sales),
    'quotes_sent', (select count(*) from sent),
    'quotes_closed', (select n from sent_closed),
    'close_rate', (select case when count(*) = 0 then null
                    else round(100.0 * (select n from sent_closed) / count(*), 1) end from sent),
    'top_materials', coalesce((select json_agg(json_build_object(
        'description', description, 'unit', unit, 'quantity', qty, 'sales', sales)) from top), '[]'::json)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_store_stats(date, date) from public;
revoke all on function public.get_store_stats(date, date) from anon;
grant execute on function public.get_store_stats(date, date) to authenticated;
