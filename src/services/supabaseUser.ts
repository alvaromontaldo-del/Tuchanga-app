import type { PostgrestError, User } from '@supabase/supabase-js';
import { File as ExpoFsFile } from 'expo-file-system';
import { getSupabaseClient } from '../lib/supabase';
import type { AuthUser, SignUpPayload } from './auth';

/**
 * Mapeo registro (app) → Supabase `public.profiles` (vía RPC `insert_profile_with_location`):
 * firstName → p_nombre → nombre
 * lastName → p_apellido → apellido
 * dni → p_dni → dni
 * phone → p_telefono → telefono
 * baseLocation.address → p_direccion → direccion_texto
 * baseLocation.lat/lng → p_lat / p_lng → location (POINT, SRID 4326; eje X = lng, eje Y = lat)
 * avatarUri (subida a bucket avatars) → p_avatar_url → avatar_url
 * offerServices + coverageKm → p_coverage_km → coverage_km
 * bio → p_bio → bio (si la migración y la función en BD lo incluyen)
 */

const PROFILE_CORE =
  'id,nombre,apellido,dni,telefono,direccion_texto,avatar_url,coverage_km,created_at' as const;
const PROFILE_WITH_LOC = `${PROFILE_CORE},location` as const;
const PROFILE_FULL = `${PROFILE_WITH_LOC},bio` as const;

type ProfileRow = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  dni?: string | null;
  telefono?: string | null;
  direccion_texto?: string | null;
  location?: unknown;
  avatar_url?: string | null;
  coverage_km?: number | null;
  created_at?: string | null;
  bio?: string | null;
};

async function fetchProfileRowForUser(userId: string): Promise<ProfileRow | null> {
  const supabase = getSupabaseClient();

  let res = await supabase.from('profiles').select(PROFILE_FULL).eq('id', userId).maybeSingle();

  if (res.error) {
    res = await supabase.from('profiles').select(PROFILE_WITH_LOC).eq('id', userId).maybeSingle();
  }

  if (res.error) {
    res = await supabase.from('profiles').select(PROFILE_CORE).eq('id', userId).maybeSingle();
  }

  if (res.error) {
    console.warn('[fetchAuthUserFromSupabase] profiles:', res.error.message);
    return null;
  }

  return (res.data as ProfileRow | null) ?? null;
}

function parseGeographyPoint(raw: unknown): { lat: number; lng: number } {
  if (raw == null) return { lat: 0, lng: 0 };
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{')) {
      try {
        return parseGeographyPoint(JSON.parse(t) as unknown);
      } catch {
        return { lat: 0, lng: 0 };
      }
    }
    const m = t.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (m) {
      return { lng: Number(m[1]), lat: Number(m[2]) };
    }
    // PostGIS geography puede venir como EWKB hex (PostgREST), ej: 0101000020E6100000...
    // Parseamos solo Point (x=lng, y=lat).
    if (/^[0-9a-fA-F]+$/.test(t) && t.length >= 42) {
      try {
        const bytes = new Uint8Array(t.length / 2);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
        }
        const dv = new DataView(bytes.buffer);
        let off = 0;
        const little = dv.getUint8(off) === 1;
        off += 1;
        let type = dv.getUint32(off, little);
        off += 4;
        const hasSrid = (type & 0x20000000) !== 0;
        type = type & 0x000000ff;
        if (hasSrid) off += 4; // srid uint32
        if (type === 1 && off + 16 <= dv.byteLength) {
          const x = dv.getFloat64(off, little);
          const y = dv.getFloat64(off + 8, little);
          return { lng: Number(x), lat: Number(y) };
        }
      } catch {
        // ignore
      }
    }
    return { lat: 0, lng: 0 };
  }
  if (typeof raw === 'object' && raw !== null && 'coordinates' in raw) {
    const c = (raw as { coordinates: number[] }).coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      return { lng: Number(c[0]), lat: Number(c[1]) };
    }
  }
  return { lat: 0, lng: 0 };
}

function guessMime(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function readUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (/^https?:\/\//i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error(`No se pudo descargar la imagen (${res.status}).`);
    }
    return res.arrayBuffer();
  }
  try {
    const file = new ExpoFsFile(uri);
    return file.arrayBuffer();
  } catch {
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error('No se pudo leer la imagen (archivo local).');
    }
    return res.arrayBuffer();
  }
}

async function uploadImageFromUri(
  bucket: string,
  path: string,
  uri: string,
  contentType: string,
): Promise<string> {
  const supabase = getSupabaseClient();
  const buf = await readUriAsArrayBuffer(uri);
  const { error } = await supabase.storage.from(bucket).upload(path, buf, {
    upsert: true,
    contentType,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

type InsertProfileRpcBase = {
  p_nombre: string;
  p_apellido: string;
  p_dni: string;
  p_telefono: string;
  p_direccion: string;
  p_lat: number;
  p_lng: number;
  p_avatar_url: string;
  p_coverage_km: number | null;
};

function isProfileDuplicateError(err: PostgrestError): boolean {
  const msg = err.message ?? '';
  return (
    err.code === '23505' || /duplicate key|unique constraint/i.test(msg)
  );
}

function shouldRetryInsertProfileWithoutBio(err: PostgrestError): boolean {
  const msg = `${err.message ?? ''} ${(err as { hint?: string }).hint ?? ''}`.toLowerCase();
  const c = err.code ?? '';
  if (c === '23505' || msg.includes('duplicate') || msg.includes('unique constraint')) {
    return false;
  }
  if (c === 'PGRST202' || c === '42883') return true;
  if (msg.includes('could not find the function')) return true;
  if (msg.includes('insert_profile_with_location')) return true;
  if (msg.includes('update_profile_registration')) return true;
  if (msg.includes('p_bio')) return true;
  if (msg.includes('column') && msg.includes('bio')) return true;
  return false;
}

async function insertProfileWithLocationRpc(
  supabase: ReturnType<typeof getSupabaseClient>,
  base: InsertProfileRpcBase,
  bioTrimmed: string,
): Promise<void> {
  const withBio = { ...base, p_bio: bioTrimmed };
  let { error } = await supabase.rpc('insert_profile_with_location', withBio);
  if (!error) return;
  if (isProfileDuplicateError(error)) return;
  if (!shouldRetryInsertProfileWithoutBio(error)) {
    throw error;
  }
  ({ error } = await supabase.rpc('insert_profile_with_location', base));
  if (!error) return;
  if (isProfileDuplicateError(error)) return;
  throw error;
}

type UpdateProfileRpcBase = {
  p_nombre: string;
  p_apellido: string;
  p_dni: string;
  p_telefono: string;
  p_direccion: string;
  p_lat: number;
  p_lng: number;
  p_avatar_url: string;
};

export type ProfileRegistrationUpdatePayload = {
  firstName: string;
  lastName: string;
  dni: string;
  phone: string;
  baseLocation: { address: string; lat: number; lng: number };
  avatarUri: string;
  bio: string;
};

async function updateProfileRegistrationRpc(
  supabase: ReturnType<typeof getSupabaseClient>,
  base: UpdateProfileRpcBase,
  bioTrimmed: string,
): Promise<void> {
  const withBio = { ...base, p_bio: bioTrimmed };
  let { error } = await supabase.rpc('update_profile_registration', withBio);
  if (!error) return;
  if (!shouldRetryInsertProfileWithoutBio(error)) {
    throw error;
  }
  ({ error } = await supabase.rpc('update_profile_registration_no_bio', base));
  if (error) throw error;
}

/** Persiste cambios de la ficha de registro (nombre, DNI, teléfono, ubicación, avatar, bio). Devuelve la URL pública del avatar. */
export async function updateProfileRegistrationInSupabase(
  payload: ProfileRegistrationUpdatePayload,
): Promise<string> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('No hay sesión activa.');

  let avatarUrl = payload.avatarUri.trim();
  if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
    const mime = guessMime(avatarUrl);
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const avatarPath = `${user.id}/avatar-${Date.now()}.${ext}`;
    avatarUrl = await uploadImageFromUri('avatars', avatarPath, avatarUrl, mime);
  }

  const lat = Number.isFinite(payload.baseLocation.lat) ? payload.baseLocation.lat : 0;
  const lng = Number.isFinite(payload.baseLocation.lng) ? payload.baseLocation.lng : 0;

  const base: UpdateProfileRpcBase = {
    p_nombre: payload.firstName.trim(),
    p_apellido: payload.lastName.trim(),
    p_dni: payload.dni.trim(),
    p_telefono: payload.phone.trim(),
    p_direccion: payload.baseLocation.address.trim(),
    p_lat: lat,
    p_lng: lng,
    p_avatar_url: avatarUrl,
  };

  await updateProfileRegistrationRpc(supabase, base, (payload.bio ?? '').trim());
  return avatarUrl;
}

export async function fetchAuthUserFromSupabase(user: User): Promise<AuthUser> {
  const supabase = getSupabaseClient();
  const email = user.email ?? '';
  const profile = await fetchProfileRowForUser(user.id);

  if (!profile) {
    return { id: user.id, email };
  }

  const { lat, lng } = parseGeographyPoint(profile.location);

  const { data: jobRows, error: jobsError } = await supabase
    .from('jobs')
    .select('id,nombre_oficio,descripcion,foto_url,es_principal')
    .eq('user_id', user.id);

  if (jobsError) {
    console.warn('[fetchAuthUserFromSupabase] jobs:', jobsError.message);
  }

  const trades = (jobRows ?? []).map((j) => ({
    id: j.id,
    name: j.nombre_oficio,
    details: j.descripcion ?? '',
    proofImageUri: j.foto_url ?? undefined,
    isPrimary: Boolean(j.es_principal),
  }));
  const primary = trades.find((t) => t.isPrimary);

  const worker =
    trades.length > 0 && profile.coverage_km != null
      ? {
          coverageKm: profile.coverage_km,
          primaryTradeName: primary?.name ?? trades[0].name,
          trades,
        }
      : undefined;

  const bioFromTrades =
    primary?.details?.trim() ||
    trades.find((t) => t.details?.trim())?.details?.trim() ||
    undefined;

  const bioFromProfile =
    typeof profile === 'object' && profile !== null && 'bio' in profile
      ? String((profile as { bio: unknown }).bio ?? '').trim()
      : '';
  const resolvedBio = bioFromProfile || bioFromTrades || undefined;

  const nombre = profile.nombre ?? '';
  const apellido = profile.apellido ?? '';

  return {
    id: profile.id,
    email,
    firstName: nombre.trim() || undefined,
    lastName: apellido.trim() || undefined,
    fullName: `${nombre} ${apellido}`.trim() || undefined,
    dni: profile.dni?.trim() || undefined,
    avatarUri: profile.avatar_url ?? undefined,
    phone: profile.telefono?.trim() || undefined,
    baseLocation: {
      address: (profile.direccion_texto ?? '').trim(),
      lat,
      lng,
    },
    location: profile.direccion_texto?.trim() || undefined,
    profileCreatedAt:
      typeof profile.created_at === 'string' ? profile.created_at : undefined,
    bio: resolvedBio,
    worker,
  };
}

/** Perfil actual desde BD (sesión Supabase). Útil para refrescar en pantallas. */
export async function fetchCurrentUserProfileFromSupabase(): Promise<AuthUser | null> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return fetchAuthUserFromSupabase(user);
}

export async function persistSignUpToSupabase(
  payload: Omit<SignUpPayload, 'password' | 'email'>,
  userId: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const mime = guessMime(payload.avatarUri);
  const avatarPath = `${userId}/avatar`;

  let avatarUrl = '';
  try {
    avatarUrl = await uploadImageFromUri('avatars', avatarPath, payload.avatarUri, mime);
  } catch (e) {
    console.warn('[persistSignUpToSupabase] avatar upload omitido:', e);
  }

  const lat = Number.isFinite(payload.baseLocation.lat) ? payload.baseLocation.lat : 0;
  const lng = Number.isFinite(payload.baseLocation.lng) ? payload.baseLocation.lng : 0;

  const rpcBase: InsertProfileRpcBase = {
    p_nombre: payload.firstName.trim(),
    p_apellido: payload.lastName.trim(),
    p_dni: payload.dni.trim(),
    p_telefono: payload.phone.trim(),
    p_direccion: payload.baseLocation.address.trim(),
    p_lat: lat,
    p_lng: lng,
    p_avatar_url: avatarUrl,
    p_coverage_km: payload.offerServices ? Math.floor(Number(payload.coverageKm) || 0) : null,
  };

  await insertProfileWithLocationRpc(supabase, rpcBase, (payload.bio ?? '').trim());

  if (payload.offerServices && payload.trades?.length) {
    const rows: Array<{
      user_id: string;
      nombre_oficio: string;
      descripcion: string;
      foto_url: string | null;
      es_principal: boolean;
    }> = [];

    for (const t of payload.trades) {
      let fotoUrl: string | null = null;
      if (t.proofImageUri) {
        try {
          const ext = t.proofImageUri.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
          fotoUrl = await uploadImageFromUri(
            'job-photos',
            `${userId}/${t.id}.${ext}`,
            t.proofImageUri,
            guessMime(t.proofImageUri),
          );
        } catch (e) {
          console.warn('[persistSignUpToSupabase] foto oficio omitida:', t.name, e);
        }
      }
      rows.push({
        user_id: userId,
        nombre_oficio: t.name.trim(),
        descripcion: t.details.trim(),
        foto_url: fotoUrl,
        es_principal: t.id === payload.primaryTradeId,
      });
    }

    const { error: je } = await supabase.from('jobs').insert(rows);
    if (je) throw je;
  }
}

export async function persistWorkerGeoToSupabase(
  baseLocation: { address: string; lat: number; lng: number },
  coverageKm: number,
): Promise<void> {
  const supabase = getSupabaseClient();
  const km = Math.max(1, Math.min(300, Math.floor(Number(coverageKm) || 0)));
  const { error } = await supabase.rpc('update_profile_geo_coverage', {
    p_direccion: baseLocation.address.trim(),
    p_lat: baseLocation.lat,
    p_lng: baseLocation.lng,
    p_coverage_km: km,
  });
  if (error) throw error;
}

export async function persistWorkerJobsToSupabase(params: {
  userId: string;
  trades: Array<{ name: string; description: string; isPrimary: boolean }>;
}): Promise<void> {
  const supabase = getSupabaseClient();

  const trimmed = (params.trades ?? [])
    .map((t) => ({
      name: (t.name ?? '').trim(),
      description: (t.description ?? '').trim(),
      isPrimary: Boolean(t.isPrimary),
    }))
    .filter((t) => t.name.length > 0)
    .slice(0, 5);

  // Preferimos RPC SECURITY DEFINER (evita problemas de RLS y asegura consistencia).
  const { error: re } = await supabase.rpc('update_worker_jobs', {
    p_jobs: trimmed.length ? trimmed : null,
  });
  if (!re) return;

  // Fallback legacy: reemplazar set por tabla (por si no se aplicó la migración aún).
  const { error: de } = await supabase.from('jobs').delete().eq('user_id', params.userId);
  if (de) throw re;

  if (trimmed.length === 0) return;

  const rows = trimmed.map((t, idx) => ({
    user_id: params.userId,
    nombre_oficio: t.name,
    descripcion: t.description,
    foto_url: null as string | null,
    es_principal: t.isPrimary || (idx === 0 && !trimmed.some((x) => x.isPrimary)),
  }));

  const { error: ie } = await supabase.from('jobs').insert(rows);
  if (ie) throw re;
}
