-- Tu Changa — rating/review_count persistentes en profiles
-- Mantiene promedio y conteo a partir de worker_reviews.

alter table if exists public.profiles
  add column if not exists rating_average numeric(6,3) not null default 0,
  add column if not exists review_count int not null default 0,
  add column if not exists total_jobs_done int not null default 0;

create or replace function public.recompute_profile_rating(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_avg numeric;
  v_done int;
begin
  if p_worker_id is null then
    return;
  end if;

  select count(*)::int, coalesce(avg(rating)::numeric, 0)
    into v_count, v_avg
  from public.worker_reviews
  where worker_id = p_worker_id;

  select count(*)::int
    into v_done
  from public.service_jobs
  where worker_id = p_worker_id
    and work_status = 'COMPLETED_BY_WORKER';

  update public.profiles
  set review_count = v_count,
      rating_average = round(v_avg::numeric, 3),
      total_jobs_done = v_done,
      updated_at = now()
  where id = p_worker_id;
end;
$$;

drop trigger if exists trg_worker_reviews_recompute_profile on public.worker_reviews;
create or replace function public.on_worker_review_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_profile_rating(new.worker_id);
  return new;
end;
$$;

create trigger trg_worker_reviews_recompute_profile
  after insert on public.worker_reviews
  for each row
  execute function public.on_worker_review_insert();

