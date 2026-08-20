-- Horarios de atención del comercio + alternativa opcional sin stock.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS opening_hours jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.stores.opening_hours IS
  'Franjas horarias JSON: [{ "open": "09:00", "close": "18:00" }, ...] (1 o 2 por día laboral).';

ALTER TABLE public.quote_items
  DROP CONSTRAINT IF EXISTS quote_items_alternative_when_out_of_stock;
