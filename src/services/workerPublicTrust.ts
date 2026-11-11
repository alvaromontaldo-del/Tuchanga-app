import { getSupabaseClient } from '../lib/supabase';
import {
  parseWorkerPublicTrustRows,
  type WorkerPublicTrustSeal,
} from '../utils/feedTrust';

export type WorkerPublicTrust = WorkerPublicTrustSeal;
export { parseWorkerPublicTrustRows };

/**
 * Sellos públicos de varios perfiles. Si el SQL todavía no está aplicado,
 * el caller sigue con el booleano que ya trajo la búsqueda o el perfil.
 */
export async function fetchWorkerPublicTrust(
  userIds: readonly string[],
): Promise<Map<string, WorkerPublicTrust>> {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return new Map();

  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('worker_public_trust', { p_user_ids: ids });
  if (error) throw error;
  return parseWorkerPublicTrustRows(data);
}
