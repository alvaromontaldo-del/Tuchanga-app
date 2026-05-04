-- Tu Changa — presupuestos (cotizaciones) + reviews en chat
-- Ejecutar después de 001_initial_schema.sql y 20260410120000_chat_conversations.sql

-- ---------------------------------------------------------------------------
-- Presupuestos por conversación (estado persistente)
-- ---------------------------------------------------------------------------

create table if not exists public.chat_quotes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  worker_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references auth.users (id) on delete cascade,
  net_amount numeric(12,2) not null check (net_amount > 0),
  fee_rate numeric(6,4) not null default 0.20 check (fee_rate >= 0 and fee_rate < 1),
  final_amount numeric(12,2) not null check (final_amount > 0),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','paid')),
  accepted_at timestamptz,
  rejected_at timestamptz,
  paid_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  replaces_quote_id uuid references public.chat_quotes (id) on delete set null,
  constraint chat_quotes_participants_match check (worker_id <> client_id)
);

create index if not exists idx_chat_quotes_conversation on public.chat_quotes (conversation_id, created_at desc);
create index if not exists idx_chat_quotes_status on public.chat_quotes (conversation_id, status, updated_at desc);

create or replace function public.touch_chat_quote_updated_at()
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

drop trigger if exists trg_chat_quotes_touch_updated_at on public.chat_quotes;
create trigger trg_chat_quotes_touch_updated_at
  before update on public.chat_quotes
  for each row
  execute function public.touch_chat_quote_updated_at();

-- Realtime
alter publication supabase_realtime add table public.chat_quotes;

-- ---------------------------------------------------------------------------
-- Reviews post-servicio (ligadas a conversación y trabajador)
-- ---------------------------------------------------------------------------

create table if not exists public.worker_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  worker_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references auth.users (id) on delete cascade,
  rating int not null check (rating >= 1 and rating <= 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  constraint worker_reviews_unique_per_conversation unique (conversation_id),
  constraint worker_reviews_participants_match check (worker_id <> client_id)
);

create index if not exists idx_worker_reviews_worker on public.worker_reviews (worker_id, created_at desc);

alter publication supabase_realtime add table public.worker_reviews;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.chat_quotes enable row level security;
alter table public.worker_reviews enable row level security;

-- Select: participantes de la conversación
drop policy if exists chat_quotes_select_participant on public.chat_quotes;
create policy chat_quotes_select_participant
on public.chat_quotes
for select
to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and (c.cliente_id = auth.uid() or c.trabajador_id = auth.uid())
  )
);

-- Insert: solo el trabajador de la conversación
drop policy if exists chat_quotes_insert_worker on public.chat_quotes;
create policy chat_quotes_insert_worker
on public.chat_quotes
for insert
to authenticated
with check (
  worker_id = auth.uid()
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.trabajador_id = auth.uid()
      and c.cliente_id = client_id
  )
);

-- Update: cliente puede aceptar/rechazar/pagar/completar; trabajador NO actualiza (recotiza insertando)
drop policy if exists chat_quotes_update_client on public.chat_quotes;
create policy chat_quotes_update_client
on public.chat_quotes
for update
to authenticated
using (
  client_id = auth.uid()
)
with check (
  client_id = auth.uid()
);

-- Reviews: select para cualquiera (se muestran en perfil), insert solo cliente y solo si hay quote completada.
drop policy if exists worker_reviews_select_all on public.worker_reviews;
create policy worker_reviews_select_all
on public.worker_reviews
for select
to authenticated
using (true);

drop policy if exists worker_reviews_insert_client on public.worker_reviews;
create policy worker_reviews_insert_client
on public.worker_reviews
for insert
to authenticated
with check (
  client_id = auth.uid()
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.cliente_id = auth.uid()
      and c.trabajador_id = worker_id
  )
  and exists (
    select 1
    from public.chat_quotes q
    where q.conversation_id = conversation_id
      and q.worker_id = worker_id
      and q.client_id = auth.uid()
      and q.status = 'paid'
      and q.completed_at is not null
  )
);

