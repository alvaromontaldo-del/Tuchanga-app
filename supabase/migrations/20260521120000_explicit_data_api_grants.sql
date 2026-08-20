-- Tu Changa — GRANTs explícitos para la Data API (PostgREST / supabase-js)
--
-- Contexto: a partir de oct 2026, tablas nuevas en `public` requieren GRANT explícito.
-- Esta migración documenta y fija permisos para tablas y RPCs existentes (idempotente).
-- RLS sigue siendo obligatorio; GRANT solo habilita el acceso vía API por rol.
--
-- Ejecutar en SQL Editor o: supabase db push

-- ---------------------------------------------------------------------------
-- Esquema
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tablas — authenticated + service_role (CRUD vía app con sesión / backend)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.jobs TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversations TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversation_reads TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversation_hides TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.posts TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.publicaciones_ocultas TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.favorites TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_quotes TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.worker_reviews TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_jobs TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_blocks TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_reports TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- anon — solo lo que la app expone sin login (feed / búsqueda vía RPC + perfiles públicos)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.profiles FROM anon;
GRANT SELECT (id, nombre, avatar_url) ON TABLE public.profiles TO anon;

-- ---------------------------------------------------------------------------
-- Funciones RPC expuestas a la app (EXECUTE)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.insert_profile_with_location(
  text, text, text, text, text, double precision, double precision, text, integer, text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_profile_registration(
  text, text, text, text, text, double precision, double precision, text, text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_profile_registration_no_bio(
  text, text, text, text, text, double precision, double precision, text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_profile_geo_coverage(
  text, double precision, double precision, integer
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_worker_jobs(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_professional_profile() TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.find_or_create_conversation(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hide_conversation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_conversation(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_unread_counts(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_total_unread_count() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_peer_read_ats(uuid[]) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.fetch_feed_posts(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_worker_posts(uuid, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hide_post(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.search_workers_for_client(
  double precision, double precision, text, text[], uuid, int
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.toggle_favorite(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_favorites() TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.accept_quote(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_payment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid) TO authenticated, service_role;
