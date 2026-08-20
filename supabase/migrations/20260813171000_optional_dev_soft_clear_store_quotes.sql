-- ============================================================================
-- OPCIONAL / DEV ONLY — NO ejecutar en producción a ciegas.
-- Soft-delete de cotizaciones de prueba del comercio del usuario autenticado.
--
-- Uso seguro (SQL Editor, con sesión del dueño del store o service_role):
--   1) Reemplazá :store_id por el UUID de TU comercio de prueba.
--   2) Descomentá el bloque.
--   3) Revisá el SELECT previo antes del UPDATE.
--
-- Qué hace:
--   - Marca quotes del store como rejected (aparecen en Rechazadas / limpian Cotizadas).
--   - No borra filas de orders pagadas (deposit_paid / completed).
-- ============================================================================

-- SELECT de preview (seguro):
-- SELECT q.id, q.status, q.created_at, o.status AS order_status, o.deposit_status
-- FROM public.quotes q
-- LEFT JOIN public.orders o ON o.quote_id = q.id
-- WHERE q.store_id = '00000000-0000-0000-0000-000000000000'::uuid
-- ORDER BY q.created_at DESC;

-- BEGIN;
-- UPDATE public.quotes q
-- SET status = 'rejected', updated_at = now()
-- WHERE q.store_id = '00000000-0000-0000-0000-000000000000'::uuid
--   AND q.status IN ('sent', 'draft')
--   AND NOT EXISTS (
--     SELECT 1 FROM public.orders o
--     WHERE o.quote_id = q.id
--       AND (
--         o.deposit_status IN ('paid', 'waived')
--         OR o.status IN ('deposit_paid', 'completed')
--         OR o.contact_revealed_at IS NOT NULL
--       )
--   );
-- COMMIT;

-- Alternativa más agresiva (solo DEV, soft-cancel orders pending):
-- UPDATE public.orders o
-- SET status = 'cancelled', updated_at = now()
-- FROM public.quotes q
-- WHERE o.quote_id = q.id
--   AND q.store_id = '00000000-0000-0000-0000-000000000000'::uuid
--   AND o.status IN ('pending_deposit', 'pending')
--   AND o.deposit_status = 'pending';

SELECT 1; -- no-op para que la migración aplique sin efectos
