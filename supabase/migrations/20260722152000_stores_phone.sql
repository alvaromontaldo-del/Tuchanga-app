-- Teléfono / WhatsApp del comercio
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
