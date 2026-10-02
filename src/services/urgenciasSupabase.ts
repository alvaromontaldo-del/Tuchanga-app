import { getSupabaseClient } from '../lib/supabase';
import { isMissingUrgenciasSchema, readAtiendeUrgencias } from '../utils/urgencias';

export { isMissingUrgenciasSchema };

export async function fetchMyAtiendeUrgencias(): Promise<boolean> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;

  const { data, error } = await sb
    .from('profiles')
    .select('atiende_urgencias')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) return false;
  return readAtiendeUrgencias((data as { atiende_urgencias?: unknown }).atiende_urgencias);
}

/** Lectura aparte: si la columna todavía no está, el perfil público sigue cargando. */
export async function fetchWorkerAtiendeUrgencias(workerUserId: string): Promise<boolean> {
  const id = workerUserId.trim();
  if (!id) return false;
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('profiles')
    .select('atiende_urgencias')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return false;
  return readAtiendeUrgencias((data as { atiende_urgencias?: unknown }).atiende_urgencias);
}

export async function setMyAtiendeUrgencias(value: boolean): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('set_my_atiende_urgencias', { p_value: value });
  if (error) throw new Error(error.message);
}
