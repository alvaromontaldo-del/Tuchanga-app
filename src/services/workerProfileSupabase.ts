import { getSupabaseClient } from '../lib/supabase';
import type { WorkerPublicProfile } from '../types/feed';
import { MAX_WORKER_TRADES } from '../types/feed';

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?u=profile';

/**
 * Perfil público para un UUID de `auth.users` / `profiles` con oficios en `jobs`.
 */
export async function fetchWorkerPublicProfileFromSupabase(
  workerUserId: string,
): Promise<WorkerPublicProfile | null> {
  const sb = getSupabaseClient();

  const { data: profile, error: pe } = await sb
    .from('profiles')
    .select('id,nombre,apellido,avatar_url,direccion_texto,bio')
    .eq('id', workerUserId)
    .maybeSingle();

  if (pe || !profile) return null;

  const { data: jobRows, error: je } = await sb
    .from('jobs')
    .select('nombre_oficio,descripcion,es_principal')
    .eq('user_id', workerUserId)
    .order('es_principal', { ascending: false });

  if (je) return null;
  const jobs = jobRows ?? [];
  if (jobs.length === 0) return null;

  const trades = jobs.slice(0, MAX_WORKER_TRADES).map((j) => ({
    title: j.nombre_oficio,
    description: j.descripcion?.trim() || 'Servicios a medida.',
    yearsExperience: 1,
  }));

  const primary = jobs.find((j) => j.es_principal) ?? jobs[0];
  const firstName = profile.nombre?.trim() || 'Profesional';
  const bioFromProfile =
    typeof profile === 'object' && profile !== null && 'bio' in profile
      ? String((profile as { bio: unknown }).bio ?? '').trim()
      : '';
  const bioBase = bioFromProfile || profile.direccion_texto?.trim() || '';

  return {
    id: profile.id,
    firstName,
    trade: primary.nombre_oficio,
    avatarUrl: profile.avatar_url?.trim() || `${DEFAULT_AVATAR}&id=${encodeURIComponent(profile.id)}`,
    bio:
      bioBase ||
      trades.map((t) => `${t.title}: ${t.description}`).join(' ').slice(0, 280) ||
      'Profesional registrado en Tu Changa.',
    ratingAverage: 0,
    reviewCount: 0,
    trades,
  };
}
