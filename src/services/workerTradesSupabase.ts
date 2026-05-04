import { getSupabaseClient } from '../lib/supabase';

/**
 * Oficios con al menos un trabajador registrado (distinct nombre_oficio en jobs).
 * Se usa para filtrar el catálogo de rubros en UI.
 */
export async function fetchActiveTradeNamesFromSupabase(): Promise<string[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  // `distinct` no siempre está tipado en supabase-js para select, pero PostgREST lo soporta.
  const res = await sb
    .from('jobs')
    .select('nombre_oficio', { count: 'exact' })
    .limit(10_000);

  if (res.error) throw res.error;
  const rows = (res.data ?? []) as Array<{ nombre_oficio?: string | null }>;
  const set = new Set<string>();
  for (const r of rows) {
    const t = String(r.nombre_oficio ?? '').trim();
    if (t) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

