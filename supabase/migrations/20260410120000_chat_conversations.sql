-- Tu Changa — complemento del chat (ejecutar después de 001_initial_schema.sql)
--
-- El esquema principal de conversaciones/mensajes, RPC find_or_create_conversation,
-- trigger touch_conversation_on_message, RLS y Realtime sobre `messages` ya están en
-- 001_initial_schema.sql. Este archivo solo:
--   • añade índices útiles para .or(cliente_id / trabajador_id) y order por updated_at;
--   • endurece permisos del RPC (revoke a PUBLIC);
--   • elimina objetos duplicados si en algún momento se aplicó una versión anterior
--     de esta migración que recreaba tablas/triggers/políticas con otros nombres.
--
-- Proyecto vacío sin 001: ejecutá primero 001 (incluye PostGIS y perfiles).

-- ---------------------------------------------------------------------------
-- Índices (no estaban en 001; mejoran listados de conversaciones)
-- ---------------------------------------------------------------------------

create index if not exists idx_conversations_cliente on public.conversations (cliente_id);
create index if not exists idx_conversations_trabajador on public.conversations (trabajador_id);
create index if not exists idx_conversations_updated on public.conversations (updated_at desc);

-- ---------------------------------------------------------------------------
-- RPC: mismo contrato que usa la app (p_trabajador_id, p_primary_trade)
-- Reemplaza la versión de 001; deja explícito updated_at al insertar.
-- DROP evita 42P13 si la firma en BD tenía otro DEFAULT en el 2.º argumento.
-- ---------------------------------------------------------------------------

drop function if exists public.find_or_create_conversation(uuid, text);

create or replace function public.find_or_create_conversation(
  p_trabajador_id uuid,
  p_primary_trade text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid := auth.uid();
  v_id uuid;
  v_trade text;
begin
  if v_cliente_id is null then
    raise exception 'not_authenticated';
  end if;
  if v_cliente_id = p_trabajador_id then
    raise exception 'invalid_peer';
  end if;

  v_trade := nullif(trim(coalesce(p_primary_trade, '')), '');

  select c.id into v_id
  from public.conversations c
  where c.cliente_id = v_cliente_id
    and c.trabajador_id = p_trabajador_id
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (cliente_id, trabajador_id, primary_trade, updated_at)
  values (v_cliente_id, p_trabajador_id, v_trade, now())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.find_or_create_conversation(uuid, text) from public;
grant execute on function public.find_or_create_conversation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Quitar duplicados si existían (migración previa con otros nombres)
-- ---------------------------------------------------------------------------

drop trigger if exists trg_messages_bump_conversation on public.messages;
drop function if exists public.bump_conversation_on_message();

-- Un solo trigger (misma lógica que 001). Cubre el caso de una DB que solo tuvo la copia
-- “completa” antigua de este archivo con bump_* y sin 001.
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_touch_conversation on public.messages;
create trigger trg_messages_touch_conversation
  after insert on public.messages
  for each row
  execute function public.touch_conversation_on_message();

drop policy if exists "conversations_select_participant" on public.conversations;
drop policy if exists "conversations_insert_as_cliente" on public.conversations;
drop policy if exists "messages_select_in_my_conversations" on public.messages;
drop policy if exists "messages_insert_as_participant" on public.messages;
