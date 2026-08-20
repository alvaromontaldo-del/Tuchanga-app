-- =============================================================================
-- Push al trabajador cuando recibe una reseña
--
-- La Edge Function `push_on_review` ya existe (verify_jwt = false).
-- La app la invoca desde `createReview` (quotesSupabase.ts).
--
-- Para que también dispare sin depender del cliente (mismo patrón que
-- `push_on_message`), configurá en Supabase Dashboard:
--
--   Database → Webhooks → Create a new hook
--   - Table: public.worker_reviews
--   - Events: INSERT
--   - Type: Supabase Edge Functions
--   - Function: push_on_review
--   - HTTP Headers: Content-Type application/json
--   - Timeout: 5000
--
-- Deploy:
--   npx supabase functions deploy push_on_review --no-verify-jwt
-- =============================================================================

COMMENT ON TABLE public.worker_reviews IS
  'Reseñas cliente→trabajador. Tras INSERT: Edge push_on_review (invoke app + Database Webhook recomendado).';
