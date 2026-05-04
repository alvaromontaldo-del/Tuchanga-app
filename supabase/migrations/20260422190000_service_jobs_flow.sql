-- Tu Changa — Jobs (contrataciones) + estados duales + reseña 1:1
-- Crea una entidad independiente que nace al aceptar una cotización.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_work_status') then
    create type public.job_work_status as enum ('PENDING','COMPLETED_BY_WORKER');
  end if;
  if not exists (select 1 from pg_type where typname = 'job_payment_status') then
    create type public.job_payment_status as enum ('PENDING','PAID');
  end if;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Jobs (contrataciones)
-- ---------------------------------------------------------------------------

create table if not exists public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  quote_id uuid not null references public.chat_quotes (id) on delete restrict,
  worker_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  description text not null default '',
  work_status public.job_work_status not null default 'PENDING',
  payment_status public.job_payment_status not null default 'PENDING',
  paid_at timestamptz,
  completed_by_worker_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_jobs_participants_match check (worker_id <> client_id),
  constraint service_jobs_unique_quote unique (quote_id)
);

create index if not exists idx_service_jobs_conversation on public.service_jobs (conversation_id, updated_at desc);
create index if not exists idx_service_jobs_worker on public.service_jobs (worker_id, updated_at desc);

create or replace function public.touch_service_job_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_service_jobs_touch_updated_at on public.service_jobs;
create trigger trg_service_jobs_touch_updated_at
  before update on public.service_jobs
  for each row
  execute function public.touch_service_job_updated_at();

-- Realtime (idempotente: si ya está, no falla)
do $$
begin
  if not exists (
    select 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'service_jobs'
  ) then
    alter publication supabase_realtime add table public.service_jobs;
  end if;
exception
  when duplicate_object then null;
end $$;

-- Backlink opcional en la cotización
alter table if exists public.chat_quotes
  add column if not exists job_id uuid references public.service_jobs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Reviews: 1:1 con Job (reusamos worker_reviews agregando job_id)
-- ---------------------------------------------------------------------------

alter table if exists public.worker_reviews
  add column if not exists job_id uuid references public.service_jobs (id) on delete cascade;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'worker_reviews_unique_per_conversation'
      and conrelid = 'public.worker_reviews'::regclass
  ) then
    alter table public.worker_reviews drop constraint worker_reviews_unique_per_conversation;
  end if;
exception when undefined_object then null;
end $$;

create unique index if not exists ux_worker_reviews_job_id on public.worker_reviews (job_id);

-- ---------------------------------------------------------------------------
-- RPCs atómicas (evitan desincronización)
-- ---------------------------------------------------------------------------

create or replace function public.accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.chat_quotes%rowtype;
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_quote
  from public.chat_quotes
  where id = p_quote_id
  for update;

  if not found then
    raise exception 'Cotización inexistente';
  end if;
  if v_quote.client_id <> auth.uid() then
    raise exception 'No autorizado';
  end if;
  if v_quote.status <> 'pending' then
    raise exception 'La cotización no está pendiente';
  end if;
  if v_quote.job_id is not null then
    return v_quote.job_id;
  end if;

  update public.chat_quotes
    set status = 'accepted',
        accepted_at = now()
  where id = v_quote.id;

  insert into public.service_jobs (
    conversation_id,
    quote_id,
    worker_id,
    client_id,
    amount,
    description,
    work_status,
    payment_status
  )
  values (
    v_quote.conversation_id,
    v_quote.id,
    v_quote.worker_id,
    v_quote.client_id,
    v_quote.final_amount,
    coalesce(v_quote.service_detail, ''),
    'PENDING',
    'PENDING'
  )
  returning id into v_job_id;

  update public.chat_quotes
    set job_id = v_job_id
  where id = v_quote.id;

  return v_job_id;
end;
$$;

revoke all on function public.accept_quote(uuid) from public;
grant execute on function public.accept_quote(uuid) to authenticated;

create or replace function public.process_payment(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.service_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_job
  from public.service_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Trabajo inexistente';
  end if;
  if v_job.client_id <> auth.uid() then
    raise exception 'No autorizado';
  end if;
  if v_job.payment_status = 'PAID' then
    return;
  end if;

  update public.service_jobs
    set payment_status = 'PAID',
        paid_at = now()
  where id = v_job.id;

  update public.chat_quotes
    set status = 'paid',
        paid_at = now()
  where id = v_job.quote_id;
end;
$$;

revoke all on function public.process_payment(uuid) from public;
grant execute on function public.process_payment(uuid) to authenticated;

create or replace function public.complete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.service_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select * into v_job
  from public.service_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Trabajo inexistente';
  end if;
  if v_job.worker_id <> auth.uid() then
    raise exception 'No autorizado';
  end if;
  if v_job.work_status = 'COMPLETED_BY_WORKER' then
    return;
  end if;

  update public.service_jobs
    set work_status = 'COMPLETED_BY_WORKER',
        completed_by_worker_at = now()
  where id = v_job.id;

  update public.chat_quotes
    set completed_at = now()
  where id = v_job.quote_id;
end;
$$;

revoke all on function public.complete_job(uuid) from public;
grant execute on function public.complete_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS para jobs
-- ---------------------------------------------------------------------------

alter table public.service_jobs enable row level security;

drop policy if exists service_jobs_select_participants on public.service_jobs;
create policy service_jobs_select_participants
on public.service_jobs
for select
to authenticated
using (client_id = auth.uid() or worker_id = auth.uid());

drop policy if exists service_jobs_insert_none on public.service_jobs;
create policy service_jobs_insert_none
on public.service_jobs
for insert
to authenticated
with check (false);

drop policy if exists service_jobs_update_none on public.service_jobs;
create policy service_jobs_update_none
on public.service_jobs
for update
to authenticated
using (false)
with check (false);

-- ---------------------------------------------------------------------------
-- Review: restringimos insert por Job (cliente + trabajo completado por trabajador)
-- ---------------------------------------------------------------------------

drop policy if exists worker_reviews_insert_client on public.worker_reviews;
create policy worker_reviews_insert_client
on public.worker_reviews
for insert
to authenticated
with check (
  client_id = auth.uid()
  and job_id is not null
  and exists (
    select 1
    from public.service_jobs j
    where j.id = job_id
      and j.client_id = auth.uid()
      and j.worker_id = worker_id
      and j.work_status = 'COMPLETED_BY_WORKER'
  )
);

