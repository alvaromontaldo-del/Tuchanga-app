import { getSupabaseClient } from '../lib/supabase';
import { normalizeCompletedJobs } from '../utils/workerReputation';

/**
 * Completa `total_jobs_done` cuando un RPC viejo no lo devuelve.
 * `null` si la consulta falla (la UI conserva el comportamiento anterior).
 */
export async function fetchCompletedJobsByProfileIds(
  ids: string[],
): Promise<Map<string, number> | null> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from('profiles').select('id,total_jobs_done').in('id', unique);
    if (error) return null;

    const out = new Map<string, number>();
    for (const row of (data ?? []) as { id?: string; total_jobs_done?: unknown }[]) {
      const id = String(row.id ?? '').trim();
      if (!id) continue;
      out.set(id, normalizeCompletedJobs(row.total_jobs_done));
    }
    return out;
  } catch {
    return null;
  }
}
