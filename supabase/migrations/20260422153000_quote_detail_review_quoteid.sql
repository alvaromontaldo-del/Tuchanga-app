-- Tu Changa — ajustes módulo cotización/reseñas
-- Agrega detalle del servicio en cotización y referencia de transacción (quote_id) en reseñas.

-- ---------------------------------------------------------------------------
-- chat_quotes: detalle del servicio
-- ---------------------------------------------------------------------------

alter table if exists public.chat_quotes
  add column if not exists service_detail text not null default '';

-- ---------------------------------------------------------------------------
-- worker_reviews: referencia a cotización pagada (transacción)
-- ---------------------------------------------------------------------------

alter table if exists public.worker_reviews
  add column if not exists quote_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'worker_reviews_quote_id_fkey'
  ) then
    alter table public.worker_reviews
      add constraint worker_reviews_quote_id_fkey
      foreign key (quote_id)
      references public.chat_quotes (id)
      on delete set null;
  end if;
end $$;

