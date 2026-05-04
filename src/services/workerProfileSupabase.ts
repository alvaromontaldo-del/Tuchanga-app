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
    .select('id,nombre,apellido,avatar_url,direccion_texto,bio,professional_description,birth_date,rating_average,review_count')
    .eq('id', workerUserId)
    .maybeSingle();

  if (pe || !profile) return null;

  // Compat: si el schema todavía no tiene `photo_urls`, reintentamos con `foto_url`.
  type JobsRowModern = {
    nombre_oficio: string;
    descripcion: string | null;
    es_principal: boolean | null;
    years_experience?: number | null;
    photo_urls?: unknown;
  };
  type JobsRowLegacy = {
    nombre_oficio: string;
    descripcion: string | null;
    es_principal: boolean | null;
    years_experience?: number | null;
    foto_url?: string | null;
  };

  let jobs: Array<JobsRowModern | JobsRowLegacy> = [];
  const modern = await sb
    .from('jobs')
    .select('nombre_oficio,descripcion,es_principal,years_experience,photo_urls')
    .eq('user_id', workerUserId)
    .order('es_principal', { ascending: false });
  if (!modern.error) {
    jobs = (modern.data as JobsRowModern[] | null) ?? [];
  } else {
    const msg = (modern.error.message ?? '').toLowerCase();
    if (!msg.includes('photo_urls') || !msg.includes('column')) return null;
    const legacy = await sb
      .from('jobs')
      .select('nombre_oficio,descripcion,es_principal,years_experience,foto_url')
      .eq('user_id', workerUserId)
      .order('es_principal', { ascending: false });
    if (legacy.error) return null;
    jobs = (legacy.data as JobsRowLegacy[] | null) ?? [];
  }
  if (jobs.length === 0) return null;

  const trades = jobs.slice(0, MAX_WORKER_TRADES).map((j) => ({
    title: j.nombre_oficio,
    description: j.descripcion?.trim() || 'Servicios a medida.',
    yearsExperience: Math.max(1, Math.min(60, Math.floor(Number((j as { years_experience?: unknown }).years_experience) || 1))),
    photoUrls: (() => {
      const fromArray = Array.isArray((j as { photo_urls?: unknown }).photo_urls)
        ? ((j as { photo_urls: string[] }).photo_urls).filter(Boolean).slice(0, 5)
        : [];
      const legacyOne = (j as { foto_url?: string | null }).foto_url?.trim() || '';
      const merged = [...(legacyOne ? [legacyOne] : []), ...fromArray].filter(Boolean).slice(0, 5);
      return merged.length ? merged : undefined;
    })(),
  }));

  const primary = jobs.find((j) => j.es_principal) ?? jobs[0];
  const firstName = profile.nombre?.trim() || 'Profesional';
  const professionalDesc =
    typeof profile === 'object' && profile !== null && 'professional_description' in profile
      ? String((profile as { professional_description: unknown }).professional_description ?? '').trim()
      : '';
  const bioFromProfile =
    typeof profile === 'object' && profile !== null && 'bio' in profile
      ? String((profile as { bio: unknown }).bio ?? '').trim()
      : '';
  const bioBase = bioFromProfile || profile.direccion_texto?.trim() || '';
  const birthDate =
    typeof profile === 'object' && profile !== null && 'birth_date' in profile
      ? String((profile as { birth_date: unknown }).birth_date ?? '').trim()
      : '';

  return {
    id: profile.id,
    firstName,
    trade: primary.nombre_oficio,
    avatarUrl: profile.avatar_url?.trim() || `${DEFAULT_AVATAR}&id=${encodeURIComponent(profile.id)}`,
    bio:
      professionalDesc ||
      bioBase ||
      trades.map((t) => `${t.title}: ${t.description}`).join(' ').slice(0, 280) ||
      'Profesional registrado en Tu Changa.',
    birthDate: birthDate || undefined,
    ratingAverage: Math.max(0, Math.min(5, Number((profile as { rating_average?: unknown }).rating_average) || 0)),
    reviewCount: Math.max(0, Math.floor(Number((profile as { review_count?: unknown }).review_count) || 0)),
    trades,
  };
}
