-- =============================================================================
-- Material requests: dirección de entrega editable (texto) + comentario
-- =============================================================================

ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS client_address text;

COMMENT ON COLUMN public.material_requests.client_address IS
  'Dirección de entrega/obra (texto). Por defecto domicilio del cliente; editable al crear la solicitud.';
