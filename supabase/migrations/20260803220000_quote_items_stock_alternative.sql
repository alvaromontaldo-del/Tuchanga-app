-- =============================================================================
-- E2: Cotización comercio — sin stock + producto alternativo por ítem
-- =============================================================================

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alternative_description text,
  ADD COLUMN IF NOT EXISTS item_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_items_alternative_when_out_of_stock'
      AND conrelid = 'public.quote_items'::regclass
  ) THEN
    ALTER TABLE public.quote_items
      ADD CONSTRAINT quote_items_alternative_when_out_of_stock CHECK (
        in_stock = true
        OR (
          alternative_description IS NOT NULL
          AND length(trim(alternative_description)) > 0
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.quote_items.in_stock IS
  'true = cotiza el ítem pedido; false = sin stock, propone alternativa.';
COMMENT ON COLUMN public.quote_items.alternative_description IS
  'Producto alternativo propuesto cuando in_stock = false.';
COMMENT ON COLUMN public.quote_items.item_note IS
  'Nota corta del comercio sobre este ítem (opcional).';
COMMENT ON COLUMN public.quote_items.unit_price IS
  'Precio unitario del ítem pedido (si hay stock) o del alternativo (si no hay).';
