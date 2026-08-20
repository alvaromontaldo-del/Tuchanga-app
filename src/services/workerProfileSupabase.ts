import { getSupabaseClient } from '../lib/supabase';
import type { WorkerPublicProfile } from '../types/feed';
import { MAX_WORKER_TRADES } from '../types/feed';

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?u=profile';

/** Normaliza photo_urls de PostgREST / Postgres (array, string JSON o literal {a,b}). */
function normalizePhotoUrls(raw: unknown, fotoUrl?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: unknown) => {
    const s = String(u ?? '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  if (Array.isArray(raw)) {
    for (const u of raw) push(u);
  } else if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) for (const u of parsed) push(u);
        else push(t);
      } catch {
        push(t);
      }
    } else if (t.startsWith('{') && t.endsWith('}')) {
      // Postgres text[] literal: {url1,url2} o {"url1","url2"}
      const inner = t.slice(1, -1).trim();
      if (inner) {
        const parts = inner.match(/(?:"(?:\\.|[^"])*"|[^,]+)/g) ?? [];
        for (const p of parts) {
          let s = p.trim();
          if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/\\"/g, '"');
          push(s);
        }
      }
    } else {
      push(t);
    }
  }

  if (fotoUrl?.trim()) {
    const first = fotoUrl.trim();
    if (!seen.has(first)) {
      out.unshift(first);
      seen.add(first);
    }
  }

  return out.slice(0, 5);
}

type TradeRow = {
  nombre_oficio: string;
  descripcion: string | null;
  es_principal: boolean | null;
  years_experience?: number | null;
  foto_url?: string | null;
  photo_urls?: unknown;
};

/**
 * Perfil público para un UUID de `auth.users` / `profiles` con oficios en `jobs`.
 */
export async function fetchWorkerPublicProfileFromSupabase(
  workerUserId: string,
): Promise<WorkerPublicProfile | null> {
  const sb = getSupabaseClient();

  const { data: profile, error: pe } = await sb
    .from('profiles')
    .select(
      'id,nombre,apellido,avatar_url,direccion_texto,bio,professional_description,birth_date,rating_average,review_count',
    )
    .eq('id', workerUserId)
    .maybeSingle();

  if (pe || !profile) return null;

  let jobs: TradeRow[] = [];

  // Preferir RPC SECURITY DEFINER (incluye fotos aunque RLS/select falle).
  const rpc = await sb.rpc('fetch_worker_trades', { p_worker_id: workerUserId });
  if (!rpc.error) {
    jobs = ((rpc.data ?? []) as TradeRow[]) ?? [];
  } else {
    const modern = await sb
      .from('jobs')
      .select('nombre_oficio,descripcion,es_principal,years_experience,foto_url,photo_urls')
      .eq('user_id', workerUserId)
      .order('es_principal', { ascending: false });
    if (!modern.error) {
      jobs = (modern.data as TradeRow[] | null) ?? [];
    } else {
      const msg = (modern.error.message ?? '').toLowerCase();
      if (!msg.includes('photo_urls') || !msg.includes('column')) return null;
      const legacy = await sb
        .from('jobs')
        .select('nombre_oficio,descripcion,es_principal,years_experience,foto_url')
        .eq('user_id', workerUserId)
        .order('es_principal', { ascending: false });
      if (legacy.error) return null;
      jobs = (legacy.data as TradeRow[] | null) ?? [];
    }
  }

  if (jobs.length === 0) return null;

  const trades = jobs.slice(0, MAX_WORKER_TRADES).map((j) => {
    const photos = normalizePhotoUrls(j.photo_urls, j.foto_url);
    return {
      title: j.nombre_oficio,
      description: j.descripcion?.trim() || 'Servicios a medida.',
      yearsExperience: Math.max(
        1,
        Math.min(60, Math.floor(Number(j.years_experience) || 1)),
      ),
      photoUrls: photos.length ? photos : undefined,
    };
  });

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
    avatarUrl:
      profile.avatar_url?.trim() ||
      `${DEFAULT_AVATAR}&id=${encodeURIComponent(profile.id)}`,
    bio:
      professionalDesc ||
      bioBase ||
      trades.map((t) => `${t.title}: ${t.description}`).join(' ').slice(0, 280) ||
      'Profesional registrado en YaChanga.',
    birthDate: birthDate || undefined,
    ratingAverage: Math.max(
      0,
      Math.min(5, Number((profile as { rating_average?: unknown }).rating_average) || 0),
    ),
    reviewCount: Math.max(
      0,
      Math.floor(Number((profile as { review_count?: unknown }).review_count) || 0),
    ),
    trades,
  };
}
