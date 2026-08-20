-- ============================================================================
-- DEV / ONE-SHOT — Wipe GLOBAL del historial de cotizaciones de materiales.
-- NO toca: profiles, stores, rubros, store_rubros, conversaciones genéricas,
--          mensajes de servicio (salvo kinds material_*), transacciones de contrataciones.
-- ============================================================================

BEGIN;

-- 1) Mensajes de chat puramente de materiales
DELETE FROM public.messages
WHERE coalesce(metadata->>'kind', '') IN (
  'material_quote',
  'material_order',
  'material_order_reveal',
  'material_list'
);

-- 2) Push events del kanban de comercio (solo hay eventos de materiales)
DELETE FROM public.store_push_events
WHERE coalesce(data->>'type', '') = 'store_board'
   OR event_type IN (
     'nueva_solicitud',
     'cotizada',
     'confirmada',
     'rechazada',
     'store_board',
     'pedido_pagado',
     'reveal',
     'order_paid',
     'quote_rejected'
   )
   OR data ? 'requestId'
   OR data ? 'quoteId'
   OR data ? 'orderId';

-- 3) Pagos MP ligados a órdenes de materiales (NO contrataciones)
DELETE FROM public.transacciones_pago
WHERE material_order_id IS NOT NULL;

-- 4) Romper ciclo orders <-> material_checkouts
UPDATE public.orders
SET payment_group_id = NULL
WHERE payment_group_id IS NOT NULL;

UPDATE public.material_checkouts
SET primary_order_id = NULL
WHERE primary_order_id IS NOT NULL;

-- 5) Órdenes de materiales (FK RESTRICT hacia quotes)
DELETE FROM public.orders;

-- 6) Checkouts multi-comercio
DELETE FROM public.material_checkouts;

-- 7) Cotizaciones e ítems
DELETE FROM public.quote_items;
DELETE FROM public.quotes;

-- 8) Destinos / ítems / pedidos
DELETE FROM public.request_target_stores;
DELETE FROM public.request_items;
DELETE FROM public.material_requests;

COMMIT;

-- Verificación post-wipe
SELECT 'material_requests' AS t, count(*)::bigint AS c FROM public.material_requests
UNION ALL SELECT 'request_items', count(*) FROM public.request_items
UNION ALL SELECT 'request_target_stores', count(*) FROM public.request_target_stores
UNION ALL SELECT 'quotes', count(*) FROM public.quotes
UNION ALL SELECT 'quote_items', count(*) FROM public.quote_items
UNION ALL SELECT 'orders', count(*) FROM public.orders
UNION ALL SELECT 'material_checkouts', count(*) FROM public.material_checkouts
UNION ALL SELECT 'transacciones_pago_material', count(*) FROM public.transacciones_pago WHERE material_order_id IS NOT NULL
UNION ALL SELECT 'messages_material_kinds', count(*) FROM public.messages WHERE coalesce(metadata->>'kind','') IN ('material_quote','material_order','material_order_reveal','material_list')
UNION ALL SELECT 'store_push_events', count(*) FROM public.store_push_events
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'stores', count(*) FROM public.stores
ORDER BY 1;
