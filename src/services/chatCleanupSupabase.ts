import { getSupabaseClient } from '../lib/supabase';
import { isSupabaseConfigured } from '../config/supabase';

/**
 * Dispara archivar chat (hide ambos) + purga de imágenes cuando ya hay
 * reseña + confirmación de pago. Fire-and-forget; la BD también lo intenta
 * vía triggers/RPC.
 */
export async function requestChatCleanupAfterJobComplete(
  contratacionId?: string | null,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const id = (contratacionId ?? '').trim();
  try {
    const sb = getSupabaseClient();
    if (id) {
      await sb.rpc('try_archive_chat_after_job_complete', {
        p_contratacion_id: id,
      });
    }
    await sb.functions.invoke('cleanup_chat_images', {
      body: id ? { contratacion_id: id } : {},
    });
  } catch {
    /* limpieza best-effort; el cron/schedule puede completar */
  }
}
