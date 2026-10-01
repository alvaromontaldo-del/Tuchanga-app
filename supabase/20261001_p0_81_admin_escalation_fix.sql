-- #81 (auditoría) fix 2026-10-01: cerrar escalada a admin y helpers internos expuestos.
-- YA APLICADO en producción (migración t81_close_admin_escalation_and_internal_helpers).
-- 1) Un usuario recién registrado podía INSERTAR su perfil con role='admin'.
REVOKE INSERT (role) ON public.profiles FROM authenticated, anon, PUBLIC;
-- 2) Helpers internos SECURITY DEFINER sin guard, ejecutables por anon/authenticated.
--    Todos sus llamadores son funciones SECURITY DEFINER de postgres -> siguen funcionando.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        '_admin_backup_and_strip_professional','_admin_billing_totals','_admin_restore_professional',
        '_admin_set_account_access','_admin_user_billing_total','_agenda_ensure_reserved',
        '_agenda_free_blocks','_agenda_lock_worker','_agenda_slot_overlaps',
        '_archive_professional_jobs_for_user','_assert_contratacion_participante',
        '_assert_sin_contratacion_activa','_chat_insert_system_event','_chat_notify_contratacion',
        '_collect_post_image_storage_paths','_copy_jobs_from_profile','_find_prior_worker_ids_for_email',
        '_material_order_payer_can_reveal','_migrate_worker_references','_notify_material_service_fee_paid',
        '_purge_worker_publications','_reject_unselected_material_quotes','_reopen_conversation_for_claim',
        '_restore_archived_jobs_for_user','_restore_jobs_snapshot_for_user','_worker_job_history_count',
        'maybe_set_professional_pending','recompute_profile_rating')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
