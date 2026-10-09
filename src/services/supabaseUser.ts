import type { PostgrestError, User } from '@supabase/supabase-js';
import { File as ExpoFsFile } from 'expo-file-system';
import { getSupabaseClient } from '../lib/supabase';
import { fetchMyProfileIdentity } from './profileIdentitySupabase';
import type { AuthUser, SignUpPayload } from './auth';
import { normalizeDisplayAddress } from '../utils/formatAddress';
import { storageOwnerFolder, userAuthDisplayName } from '../utils/storageOwnerFolder';
import { resolveProfessionalDescription } from '../utils/professionalDescription';
import { completedJobsFromPayload } from '../utils/workerReputation';
import { onlyDigits, type AccountDocumentType } from '../utils/argentineCuit';

/**
 * Mapeo registro (app) → Supabase `public.profiles` (vía RPC `insert_profile_with_location`):
 * firstName → p_nombre → nombre
 * lastName → p_apellido → apellido
 * dni → p_dni → dni
 * documentType → p_document_type → document_type ('dni' | 'cuit')
 * phone → p_telefono → telefono
 * baseLocation.address → p_direccion → direccion_texto
 * baseLocation.lat/lng → p_lat / p_lng → location (POINT, SRID 4326; eje X = lng, eje Y = lat)
 * baseLocation.completeAddress + lat/lng → set_my_direccion_exacta → direccion_completa / direccion_lat / direccion_lng
 * avatarUri (subida a bucket avatars) → p_avatar_url → avatar_url
 * offerServices + coverageKm → p_coverage_km → coverage_km
 * professionalDescription → p_bio del RPC → professional_description
 * (el argumento del RPC se sigue llamando p_bio; la columna bio ya no existe)
 */

/**
 * Columnas de profiles que no son PII. DNI, teléfono, domicilio y nacimiento salen de
 * get_my_profile_private; apellido y ubicación exacta, de get_my_profile_identity (#120).
 */
const PROFILE_PUBLIC_CORE =
  'id,nombre,document_type,avatar_url,coverage_km,created_at,rating_average,review_count,total_jobs_done,professional_description' as const;

export type MyProfilePrivate = {
  dni: string | null;
  telefono: string | null;
  direccion_texto: string | null;
  detalles_ubicacion: string | null;
  birth_date: string | null;
};

function textOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function birthDateOrNull(v: unknown): string | null {
  const s = textOrNull(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function firstPrivateRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row as Record<string, unknown>;
}

/** PII del usuario autenticado. El RPC solo lee auth.uid(); no acepta otro id. */
export async function fetchMyProfilePrivate(): Promise<MyProfilePrivate | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_my_profile_private');
  if (error) {
    console.warn('[get_my_profile_private]', error.message);
    return null;
  }
  const row = firstPrivateRow(data);
  if (!row) return null;
  return {
    dni: textOrNull(row.dni),
    telefono: textOrNull(row.telefono),
    direccion_texto: textOrNull(row.direccion_texto),
    detalles_ubicacion: textOrNull(row.detalles_ubicacion),
    birth_date: birthDateOrNull(row.birth_date),
  };
}

type ProfileRow = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  dni?: string | null;
  document_type?: string | null;
  telefono?: string | null;
  direccion_texto?: string | null;
  detalles_ubicacion?: string | null;
  location?: unknown;
  avatar_url?: string | null;
  coverage_km?: number | null;
  created_at?: string | null;
  rating_average?: number | null;
  review_count?: number | null;
  total_jobs_done?: number | null;
  birth_date?: string | null;
  professional_description?: string | null;
};

async function fetchProfileRowForUser(userId: string): Promise<ProfileRow | null> {
  const supabase = getSupabaseClient();

  const res = await supabase.from('profiles').select(PROFILE_PUBLIC_CORE).eq('id', userId).maybeSingle();

  if (res.error) {
    console.warn('[fetchAuthUserFromSupabase] profiles:', res.error.message);
    return null;
  }

  const row = (res.data as ProfileRow | null) ?? null;
  if (!row) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id !== userId) return row;

  const [priv, identity] = await Promise.all([fetchMyProfilePrivate(), fetchMyProfileIdentity()]);
  const own: ProfileRow = identity
    ? {
        ...row,
        apellido: identity.apellido,
        location:
          identity.lat != null && identity.lng != null
            ? { type: 'Point', coordinates: [identity.lng, identity.lat] }
            : null,
      }
    : row;
  if (!priv) return own;
  return {
    ...own,
    dni: priv.dni,
    telefono: priv.telefono,
    direccion_texto: priv.direccion_texto,
    detalles_ubicacion: priv.detalles_ubicacion,
    birth_date: priv.birth_date,
  };
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
  // file:// / content:// / ph:// — Expo File primero; fetch como fallback.
  try {
    const file = new ExpoFsFile(uri);
    return await file.arrayBuffer();
  } catch {
    /* continuar */
  }
  try {
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error('No se pudo leer la imagen (archivo local).');
    }
    return await res.arrayBuffer();
  } catch {
    throw new Error(
      'No se pudo leer la foto. Probá elegirla de nuevo desde Galería o Cámara.',
    );
  }
}

async function normalizeArPhoneE164(phone: string | null | undefined): Promise<string | null> {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('54')) return `+${digits}`;
  if (digits.startsWith('549')) return `+${digits}`;
  // Celular AR típico 10 dígitos (11…) o con 0 / 15
  const local = digits.replace(/^0/, '').replace(/^15/, '');
  return `+54${local}`;
}

/** Sincroniza Display name (DNI_Apellido) y teléfono a Auth Users (además de profiles). */
async function syncAuthUserDirectory(params: {
  dni?: string | null;
  lastName?: string | null;
  phone?: string | null;
}): Promise<void> {
  const label = userAuthDisplayName(params);
  const phoneE164 = await normalizeArPhoneE164(params.phone);
  if (!label && !phoneE164) return;

  const supabase = getSupabaseClient();
  const data: Record<string, string> = {};
  if (label) {
    data.display_name = label;
    data.full_name = label;
    data.name = label;
  }
  if (phoneE164) {
    data.phone = phoneE164;
  }

  const { error: metaErr } = await supabase.auth.updateUser({ data });
  if (metaErr) {
    console.warn('[syncAuthUserDirectory] metadata:', metaErr.message);
  }

  // Columna Phone del dashboard: no usar updateUser({ phone }) (exige SMS / Phone Auth).
  // RPC SECURITY DEFINER escribe en auth.users (y el trigger de profiles también lo hace).
  if (phoneE164) {
    const { error: phoneErr } = await supabase.rpc('sync_my_auth_phone', { p_phone: phoneE164 });
    if (phoneErr) {
      console.warn('[syncAuthUserDirectory] sync_my_auth_phone:', phoneErr.message);
    }
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
  // Uint8Array es el formato más fiable con supabase-js en React Native.
  const bytes = new Uint8Array(buf);
  if (!bytes.byteLength) {
    throw new Error('La imagen quedó vacía. Elegí otra foto.');
  }
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    upsert: true,
    contentType,
    cacheControl: '3600',
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/** Carpeta Storage `{dni}_{apellido}` (o UUID si faltan datos). */
async function resolveStorageOwnerFolder(
  userId: string,
  overrides?: { dni?: string | null; lastName?: string | null },
): Promise<string> {
  if (overrides?.dni != null || overrides?.lastName != null) {
    return storageOwnerFolder({
      userId,
      dni: overrides.dni,
      lastName: overrides.lastName,
    });
  }
  const profile = await fetchProfileRowForUser(userId);
  return storageOwnerFolder({
    userId,
    dni: profile?.dni,
    lastName: profile?.apellido,
  });
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
  p_document_type: AccountDocumentType;
};

function isProfileDuplicateError(err: PostgrestError): boolean {
  const msg = err.message ?? '';
  return (
    err.code === '23505' || /duplicate key|unique constraint/i.test(msg)
  );
}

function dniLockedMessage(message: string | undefined): string | null {
  if (/dni_locked/i.test(message ?? '')) {
    return 'El DNI no se puede modificar una vez cargado.';
  }
  return null;
}

function duplicateIdentityMessage(err: PostgrestError): string {
  const msg = (err.message ?? '').toLowerCase();
  if (msg.includes('dni') || msg.includes('profiles_dni')) {
    return 'No se pudo crear la cuenta: este DNI ya está registrado.';
  }
  if (msg.includes('telefono') || msg.includes('phone') || msg.includes('celular')) {
    return 'No se pudo crear la cuenta: este celular ya está registrado.';
  }
  return 'No se pudo crear la cuenta: este correo o DNI ya está registrado.';
}

/**
 * Guarda el pin y la dirección completa del propio usuario.
 * No cambia direccion_texto (la ficha sigue mostrando la calle corta).
 * Si el SQL todavía no está aplicado, no corta el alta.
 */
async function saveExactDireccion(
  supabase: ReturnType<typeof getSupabaseClient>,
  base: { lat: number; lng: number; completeAddress?: string | null },
): Promise<void> {
  const lat = Number.isFinite(base.lat) ? base.lat : null;
  const lng = Number.isFinite(base.lng) ? base.lng : null;
  const completa = base.completeAddress?.trim() || null;
  if ((lat == null || lng == null || (lat === 0 && lng === 0)) && !completa) return;
  const { error } = await supabase.rpc('set_my_direccion_exacta', {
    p_lat: lat,
    p_lng: lng,
    p_direccion_completa: completa,
  });
  if (!error) return;
  if (isMissingRpc(error)) {
    console.warn('[set_my_direccion_exacta] SQL todavía no aplicado');
    return;
  }
  throw new Error(`No se pudo guardar la ubicación exacta (${error.message}).`);
}

function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist')
  );
}

/**
 * `update_profile_registration_full` no escribe la descripción. El RPC
 * `update_professional_description` (SECURITY DEFINER) guarda
 * professional_description. El editor lee esa columna, no un borrador local.
 */
async function writeOwnProfessionalDescription(
  supabase: ReturnType<typeof getSupabaseClient>,
  userId: string,
  raw: string,
): Promise<void> {
  const text = raw.trim();
  if (!text) return;

  const { error: rpcErr } = await supabase.rpc('update_professional_description', {
    p_description: text,
  });
  if (!rpcErr) return;
  if (/professional_description_too_long/i.test(rpcErr.message ?? '')) {
    throw new Error('La descripción profesional no puede superar los 500 caracteres.');
  }

  const direct = await supabase
    .from('profiles')
    .update({ professional_description: text })
    .eq('id', userId)
    .select('id');
  if (!direct.error && (direct.data?.length ?? 0) > 0) return;

  if (!isMissingRpc(rpcErr)) {
    throw new Error(
      'No se pudo guardar la descripción profesional. Volvé a intentar en un momento.',
    );
  }
  throw new Error(
    `No se pudo guardar la descripción profesional (${direct.error?.message ?? rpcErr.message}).`,
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
  descriptionTrimmed: string,
): Promise<void> {
  const withDescription = { ...base, p_bio: descriptionTrimmed };
  let { error } = await supabase.rpc('insert_profile_with_location', withDescription);
  if (!error) return;
  if (isProfileDuplicateError(error)) {
    throw new Error(duplicateIdentityMessage(error));
  }
  if (!shouldRetryInsertProfileWithoutBio(error)) {
    throw error;
  }
  ({ error } = await supabase.rpc('insert_profile_with_location', base));
  if (!error) return;
  if (isProfileDuplicateError(error)) {
    throw new Error(duplicateIdentityMessage(error));
  }
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
  baseLocation: { address: string; lat: number; lng: number; completeAddress?: string | null };
  avatarUri: string;
  /** Si se omite, no se modifica la descripción profesional. */
  professionalDescription?: string;
  /** YYYY-MM-DD; si se omite, no modifica birth_date. Usá '' para limpiar. */
  birthDate?: string;
  /** Referencias opcionales para ubicar el domicilio. Usá '' para limpiar. */
  locationDetails?: string;
  /** Si se omite, el RPC full usa su default (`dni`). */
  documentType?: AccountDocumentType;
};

async function updateProfileRegistrationRpc(
  supabase: ReturnType<typeof getSupabaseClient>,
  base: UpdateProfileRpcBase,
  descriptionTrimmed: string,
): Promise<void> {
  const withDescription = { ...base, p_bio: descriptionTrimmed };
  let { error } = await supabase.rpc('update_profile_registration', withDescription);
  if (!error) return;
  if (!shouldRetryInsertProfileWithoutBio(error)) {
    throw error;
  }
  ({ error } = await supabase.rpc('update_profile_registration_no_bio', base));
  if (error) throw error;
}

/** Persiste cambios de la ficha de registro (nombre, DNI, teléfono, ubicación, avatar). Si viene la descripción, la guarda en professional_description. */
export async function updateProfileRegistrationInSupabase(
  payload: ProfileRegistrationUpdatePayload,
): Promise<string> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('No hay sesión activa.');

  let avatarUrl = payload.avatarUri.trim();
  const isLocalAvatar = Boolean(avatarUrl) && !/^https?:\/\//i.test(avatarUrl);

  if (isLocalAvatar) {
    const mime = guessMime(avatarUrl);
    const ext = mime.includes('png') ? 'png' : 'jpg';
    try {
      avatarUrl = await uploadImageFromUri(
        'avatars',
        `${user.id}/avatar-${Date.now()}.${ext}`,
        avatarUrl,
        mime,
      );
      const { error: avErr } = await supabase.rpc('set_my_avatar_url', { p_url: avatarUrl });
      if (avErr) {
        console.warn('[updateProfileRegistration] set_my_avatar_url:', avErr.message);
      }
    } catch (e) {
      // No bloquear el guardado de dirección/datos por RLS de Storage.
      const { data: existing } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      const prev = String((existing as { avatar_url?: string | null } | null)?.avatar_url ?? '').trim();
      if (prev) {
        console.warn('[updateProfileRegistration] avatar omitido (Storage RLS), se mantiene el actual');
        avatarUrl = prev;
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`No se pudo subir la foto de perfil (${msg}).`);
      }
    }
  }

  const lat = Number.isFinite(payload.baseLocation.lat) ? payload.baseLocation.lat : 0;
  const lng = Number.isFinite(payload.baseLocation.lng) ? payload.baseLocation.lng : 0;

  const touchBirth = payload.birthDate !== undefined;
  const touchDetalles = payload.locationDetails !== undefined;

  // Preferir RPC full (dirección + detalles + fecha en un solo SECURITY DEFINER).
  const { error: fullErr } = await supabase.rpc('update_profile_registration_full', {
    p_nombre: payload.firstName.trim(),
    p_apellido: payload.lastName.trim(),
    p_dni: onlyDigits(payload.dni),
    p_telefono: payload.phone.trim(),
    p_direccion: normalizeDisplayAddress(payload.baseLocation.address),
    p_lat: lat,
    p_lng: lng,
    p_avatar_url: avatarUrl,
    p_detalles_ubicacion: touchDetalles ? (payload.locationDetails?.trim() ?? '') : null,
    p_birth_date: touchBirth ? (payload.birthDate?.trim() ?? '') : null,
    p_touch_detalles: touchDetalles,
    p_touch_birth_date: touchBirth,
    p_document_type: payload.documentType === 'cuit' ? 'cuit' : 'dni',
  });

  const fullMissing =
    !!fullErr &&
    /could not find the function|pgrst202|does not exist|404/i.test(fullErr.message ?? '');

  if (fullErr && !fullMissing) {
    const locked = dniLockedMessage(fullErr.message);
    if (locked) throw new Error(locked);
    throw new Error(`No se pudo guardar el perfil (${fullErr.message}).`);
  }

  if (fullMissing) {
    // Fallback: RPC legacy + extras (BD sin migración nueva).
    const base: UpdateProfileRpcBase = {
      p_nombre: payload.firstName.trim(),
      p_apellido: payload.lastName.trim(),
      p_dni: onlyDigits(payload.dni),
      p_telefono: payload.phone.trim(),
      p_direccion: normalizeDisplayAddress(payload.baseLocation.address),
      p_lat: lat,
      p_lng: lng,
      p_avatar_url: avatarUrl,
    };

    const descriptionToStore =
      payload.professionalDescription !== undefined ? payload.professionalDescription.trim() : undefined;
    try {
      if (descriptionToStore !== undefined) {
        await updateProfileRegistrationRpc(supabase, base, descriptionToStore);
      } else {
        const { error } = await supabase.rpc('update_profile_registration_no_bio', base);
        if (error) throw error;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const locked = dniLockedMessage(msg);
      if (locked) throw new Error(locked);
      throw new Error(`No se pudo guardar el perfil (${msg}).`);
    }

    if (touchBirth || touchDetalles) {
      const { error: extrasErr } = await supabase.rpc('update_profile_extras', {
        p_birth_date: touchBirth ? (payload.birthDate?.trim() ?? '') : null,
        p_detalles_ubicacion: touchDetalles ? (payload.locationDetails?.trim() ?? '') : null,
        p_touch_birth_date: touchBirth,
        p_touch_detalles: touchDetalles,
      });
      if (extrasErr) {
        throw new Error(
          `Se guardó la dirección, pero no los detalles/fecha (${extrasErr.message}). Ejecutá el SQL de update_profile_registration_full en Supabase.`,
        );
      }
    }
  }

  // El RPC full no toca la descripción. El alta profesional la manda acá.
  if (!fullMissing && !fullErr && payload.professionalDescription !== undefined && payload.professionalDescription.trim()) {
    await writeOwnProfessionalDescription(supabase, user.id, payload.professionalDescription);
  }

  await saveExactDireccion(supabase, payload.baseLocation);

  try {
    await syncAuthUserDirectory({
      dni: payload.dni,
      lastName: payload.lastName,
      phone: payload.phone,
    });
  } catch (e) {
    console.warn('[updateProfileRegistration] sync Auth omitido:', e);
  }
  return avatarUrl;
}

/**
 * Sube una foto local al bucket `avatars` y actualiza `profiles.avatar_url`
 * (RPC `set_my_avatar_url`). Devuelve la URL pública.
 */
export async function updateMyAvatarFromUri(localUri: string): Promise<string> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('No hay sesión activa.');

  const uri = localUri.trim();
  if (!uri) throw new Error('Elegí una foto de perfil.');

  if (/^https?:\/\//i.test(uri)) {
    const { error: avErr } = await supabase.rpc('set_my_avatar_url', { p_url: uri });
    if (avErr) throw new Error(avErr.message || 'No se pudo guardar la foto.');
    return uri;
  }

  const mime = guessMime(uri);
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const publicUrl = await uploadImageFromUri(
    'avatars',
    `${user.id}/avatar-${Date.now()}.${ext}`,
    uri,
    mime,
  );

  const { error: avErr } = await supabase.rpc('set_my_avatar_url', { p_url: publicUrl });
  if (avErr) {
    const { error: upErr } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', user.id);
    if (upErr) {
      throw new Error(
        `La foto se subió pero no quedó en el perfil (${avErr.message}). Ejecutá el SQL set_my_avatar_url en Supabase.`,
      );
    }
  }
  return publicUrl;
}

/**
 * Lat/lng del domicilio registrado en `profiles.location` (para obra / materiales).
 * Devuelve null si no hay punto usable.
 */
export async function fetchProfileBaseLocation(
  userId: string,
): Promise<{ lat: number; lng: number } | null> {
  const profile = await fetchProfileRowForUser(userId);
  if (!profile?.location) return null;
  const { lat, lng } = parseGeographyPoint(profile.location);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Domicilio registrado: texto (`direccion_texto`) + coordenadas si existen.
 * Solo sirve para el propio usuario: el texto y las coordenadas de otro no se
 * leen de profiles (PII, #120). Para el cliente de un chat se usa el RPC
 * get_conversation_client_delivery_address.
 */
export async function fetchProfileDeliveryAddress(userId: string): Promise<{
  address: string;
  lat: number | null;
  lng: number | null;
} | null> {
  const profile = await fetchProfileRowForUser(userId);
  if (!profile) return null;

  const address = normalizeDisplayAddress(profile.direccion_texto ?? '').trim();
  let lat: number | null = null;
  let lng: number | null = null;
  if (profile.location) {
    const parsed = parseGeographyPoint(profile.location);
    if (
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng) &&
      !(parsed.lat === 0 && parsed.lng === 0)
    ) {
      lat = parsed.lat;
      lng = parsed.lng;
    }
  }
  if (!address && lat == null) return null;
  return { address, lat, lng };
}

export async function fetchAuthUserFromSupabase(user: User): Promise<AuthUser> {
  const supabase = getSupabaseClient();
  const email = user.email ?? '';
  const profile = await fetchProfileRowForUser(user.id);

  if (!profile) {
    return { id: user.id, email };
  }

  const { lat, lng } = parseGeographyPoint(profile.location);

  // Compat: si el schema todavía no tiene `photo_urls`, reintentamos sin esa columna.
  type JobRow = {
    id: string;
    nombre_oficio: string;
    descripcion: string | null;
    foto_url: string | null;
    es_principal: boolean | null;
    years_experience?: number | null;
    photo_urls?: unknown;
  };
  let jobRows: JobRow[] = [];

  const modern = await supabase
    .from('jobs')
    .select('id,nombre_oficio,descripcion,foto_url,es_principal,years_experience,photo_urls')
    .eq('user_id', user.id);

  if (!modern.error) {
    jobRows = ((modern.data as unknown) as JobRow[] | null) ?? [];
  } else {
    const msg = (modern.error.message ?? '').toLowerCase();
    if (msg.includes('photo_urls') && msg.includes('column')) {
      const legacy = await supabase
        .from('jobs')
        .select('id,nombre_oficio,descripcion,foto_url,es_principal,years_experience')
        .eq('user_id', user.id);
      if (!legacy.error) jobRows = ((legacy.data as unknown) as JobRow[] | null) ?? [];
      else console.warn('[fetchAuthUserFromSupabase] jobs legacy:', legacy.error.message);
    } else {
      console.warn('[fetchAuthUserFromSupabase] jobs:', modern.error.message);
    }
  }

  const trades = (jobRows ?? []).map((j) => {
    const photoUrls = Array.isArray((j as { photo_urls?: unknown }).photo_urls)
      ? ((j as { photo_urls: string[] }).photo_urls).filter(Boolean).slice(0, 5)
      : [];
    const proof = (j.foto_url ?? '').trim();
    const mergedPhotos = [
      ...(proof ? [proof] : []),
      ...photoUrls,
    ]
      .filter(Boolean)
      .slice(0, 5);

    return {
      id: j.id,
      name: j.nombre_oficio,
      details: j.descripcion ?? '',
      proofImageUri: mergedPhotos[0] ?? undefined,
      yearsExperience: Math.max(
        1,
        Math.min(60, Math.floor(Number((j as { years_experience?: unknown }).years_experience) || 1)),
      ),
      isPrimary: Boolean(j.es_principal),
      // Campo opcional que viaja solo en memoria (WorkerABM).
      proofImageUris: mergedPhotos.length ? mergedPhotos : undefined,
    };
  });
  const primary = trades.find((t) => t.isPrimary);

  const worker =
    trades.length > 0 && profile.coverage_km != null
      ? {
          coverageKm: profile.coverage_km,
          primaryTradeName: primary?.name ?? trades[0].name,
          trades,
        }
      : undefined;

  const tradeFallback =
    primary?.details?.trim() ||
    trades.find((t) => t.details?.trim())?.details?.trim() ||
    undefined;

  const professionalDescription = resolveProfessionalDescription({
    professionalDescription: profile.professional_description,
    tradeFallback,
  });

  const nombre = profile.nombre ?? '';
  const apellido = profile.apellido ?? '';

  return {
    id: profile.id,
    email,
    firstName: nombre.trim() || undefined,
    lastName: apellido.trim() || undefined,
    fullName: `${nombre} ${apellido}`.trim() || undefined,
    dni: profile.dni?.trim() || undefined,
    documentType: profile.document_type === 'cuit' ? 'cuit' : 'dni',
    avatarUri: profile.avatar_url ?? undefined,
    phone: profile.telefono?.trim() || undefined,
    baseLocation: {
      address: normalizeDisplayAddress(profile.direccion_texto ?? ''),
      lat,
      lng,
    },
    location: normalizeDisplayAddress(profile.direccion_texto) || undefined,
    locationDetails:
      typeof profile.detalles_ubicacion === 'string' && profile.detalles_ubicacion.trim()
        ? profile.detalles_ubicacion.trim()
        : undefined,
    profileCreatedAt:
      typeof profile.created_at === 'string' ? profile.created_at : undefined,
    professionalDescription,
    worker,
    ratingAverage:
      typeof profile.rating_average === 'number'
        ? Math.max(0, Math.min(5, Number(profile.rating_average) || 0))
        : undefined,
    reviewCount:
      typeof profile.review_count === 'number'
        ? Math.max(0, Math.floor(Number(profile.review_count) || 0))
        : undefined,
    totalJobsDone: completedJobsFromPayload(profile, 'total_jobs_done'),
    birthDate:
      typeof profile.birth_date === 'string' && profile.birth_date.trim()
        ? profile.birth_date.trim()
        : undefined,
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
  // Carpeta UUID: coincide con las políticas Storage estándar (avatars/{uid}/...).
  const folder = userId;

  const lat = Number.isFinite(payload.baseLocation.lat) ? payload.baseLocation.lat : 0;
  const lng = Number.isFinite(payload.baseLocation.lng) ? payload.baseLocation.lng : 0;

  const existing = await fetchProfileRowForUser(userId);

  // Si ya hay fila (trigger / confirmación email / reintento), completar con UPDATE
  // en lugar de insertar (evita perder birth_date/avatar al descartar el pending).
  if (existing) {
    await updateProfileRegistrationInSupabase({
      firstName: payload.firstName,
      lastName: payload.lastName,
      dni: onlyDigits(payload.dni),
      phone: payload.phone,
      baseLocation: payload.baseLocation,
      avatarUri: payload.avatarUri,
      professionalDescription: payload.professionalDescription,
      birthDate: payload.birthDate?.trim() ?? '',
      locationDetails: payload.locationDetails?.trim() ?? '',
      documentType: payload.documentType === 'cuit' ? 'cuit' : 'dni',
    });

    if (payload.offerServices && payload.trades?.length) {
      await persistSignUpTrades(supabase, folder, userId, payload);
    }
    if ((payload.professionalDescription ?? '').trim()) {
      await writeOwnProfessionalDescription(supabase, userId, payload.professionalDescription ?? '');
    }
    return;
  }

  // Perfil primero (sin avatar); después subimos la foto y actualizamos la URL.
  const rpcBase: InsertProfileRpcBase = {
    p_nombre: payload.firstName.trim(),
    p_apellido: payload.lastName.trim(),
    p_dni: onlyDigits(payload.dni),
    p_telefono: payload.phone.trim(),
    p_direccion: normalizeDisplayAddress(payload.baseLocation.address),
    p_lat: lat,
    p_lng: lng,
    p_avatar_url: '',
    p_coverage_km: payload.offerServices ? Math.floor(Number(payload.coverageKm) || 0) : null,
    p_document_type: payload.documentType === 'cuit' ? 'cuit' : 'dni',
  };

  try {
    await insertProfileWithLocationRpc(supabase, rpcBase, (payload.professionalDescription ?? '').trim());
    await saveExactDireccion(supabase, payload.baseLocation);
  } catch (e) {
    // Carrera con trigger: el perfil apareció entre el SELECT y el INSERT.
    if (await fetchProfileRowForUser(userId)) {
      await updateProfileRegistrationInSupabase({
        firstName: payload.firstName,
        lastName: payload.lastName,
        dni: onlyDigits(payload.dni),
        phone: payload.phone,
        baseLocation: payload.baseLocation,
        avatarUri: payload.avatarUri,
        professionalDescription: payload.professionalDescription,
        birthDate: payload.birthDate?.trim() ?? '',
        locationDetails: payload.locationDetails?.trim() ?? '',
        documentType: payload.documentType === 'cuit' ? 'cuit' : 'dni',
      });
      if (payload.offerServices && payload.trades?.length) {
        await persistSignUpTrades(supabase, folder, userId, payload);
      }
      if ((payload.professionalDescription ?? '').trim()) {
        await writeOwnProfessionalDescription(supabase, userId, payload.professionalDescription ?? '');
      }
      return;
    }
    throw e;
  }

  try {
    await syncAuthUserDirectory({
      dni: payload.dni,
      lastName: payload.lastName,
      phone: payload.phone,
    });
  } catch {
    /* no bloquear el alta */
  }

  let avatarUrl = '';
  try {
    const mime = guessMime(payload.avatarUri);
    const avatarPath = `${folder}/avatar-${Date.now()}.jpg`;
    avatarUrl = await uploadImageFromUri('avatars', avatarPath, payload.avatarUri, mime);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`No se pudo subir la foto de perfil (${msg}). Revisá permisos de Storage.`);
  }

  // Actualizar avatar vía RPC SECURITY DEFINER (evita RLS en UPDATE directo).
  {
    const { error: avErr } = await supabase.rpc('set_my_avatar_url', { p_url: avatarUrl });
    if (avErr) {
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', userId);
      if (upErr) {
        throw new Error(
          `La foto se subió pero no quedó en el perfil (${upErr.message}). Ejecutá el SQL set_my_avatar_url en Supabase.`,
        );
      }
    }
  }

  if ((payload.professionalDescription ?? '').trim()) {
    await writeOwnProfessionalDescription(supabase, userId, payload.professionalDescription ?? '');
  }

  // Fecha / detalles: preferir RPC extras (SECURITY DEFINER).
  const birth = payload.birthDate?.trim() ?? '';
  const detalles = payload.locationDetails?.trim() ?? '';
  if (birth || detalles) {
    const { error: exErr } = await supabase.rpc('update_profile_extras', {
      p_birth_date: birth || null,
      p_detalles_ubicacion: detalles || null,
      p_touch_birth_date: Boolean(birth),
      p_touch_detalles: Boolean(detalles),
    });
    if (exErr) {
      if (birth) {
        const { error: bdErr } = await supabase
          .from('profiles')
          .update({ birth_date: birth })
          .eq('id', userId);
        if (bdErr) {
          throw new Error(
            `No se pudo guardar la fecha de nacimiento (${bdErr.message}). Ejecutá update_profile_extras en Supabase.`,
          );
        }
      }
      if (detalles) {
        const { error: detErr } = await supabase
          .from('profiles')
          .update({ detalles_ubicacion: detalles })
          .eq('id', userId);
        if (detErr) {
          console.warn('[persistSignUpToSupabase] detalles_ubicacion:', detErr.message);
        }
      }
    }
  }

  if (payload.offerServices && payload.trades?.length) {
    await persistSignUpTrades(supabase, folder, userId, payload);
  }
}

async function persistSignUpTrades(
  supabase: ReturnType<typeof getSupabaseClient>,
  folder: string,
  userId: string,
  payload: Omit<SignUpPayload, 'password' | 'email'>,
): Promise<void> {
  if (!payload.trades?.length) return;

  // Versionado por guardado: evita cache de URLs cuando se reemplazan imágenes.
  const version = `v_${Date.now()}`;
  const storageFolder = folder;
  const rows: Array<{
    user_id: string;
    nombre_oficio: string;
    descripcion: string;
    foto_url: string | null;
    es_principal: boolean;
    photo_urls: string[];
  }> = [];

  for (const t of payload.trades) {
    const uploads: string[] = [];
    const sources = [
      ...((t.proofImageUris ?? []).map((u) => (u ?? '').trim()).filter(Boolean).slice(0, 5)),
      ...((t.proofImageUri ?? '').trim() ? [(t.proofImageUri ?? '').trim()] : []),
    ]
      .filter(Boolean)
      // evitamos duplicados triviales
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .slice(0, 5);

    for (let p = 0; p < sources.length; p++) {
      const uri = sources[p]!;
      try {
        if (/^https?:\/\//i.test(uri)) {
          uploads.push(uri);
        } else {
          const ext = uri.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
          const path = `${storageFolder}/jobs/${t.id}/${version}/${p}.${ext}`;
          uploads.push(await uploadImageFromUri('job-photos', path, uri, guessMime(uri)));
        }
      } catch (e) {
        console.warn('[persistSignUpToSupabase] foto oficio omitida:', t.name, e);
      }
    }

    const fotoUrl = uploads[0] ?? null;
    rows.push({
      user_id: userId,
      nombre_oficio: t.name.trim(),
      descripcion: t.details.trim(),
      foto_url: fotoUrl,
      es_principal: t.id === payload.primaryTradeId,
      photo_urls: uploads.slice(0, 5),
    });
  }

  // El INSERT dispara trg_jobs_professional_pending. Con el mail ya validado
  // el perfil queda pending. No se aprueba solo: lo aprueba o lo rechaza el admin.
  const { error: je } = await supabase.from('jobs').insert(rows);
  if (!je) return;

  const msg = `${je.message ?? ''} ${(je as { hint?: string }).hint ?? ''}`.toLowerCase();
  const missingPhotos = msg.includes('photo_urls') && msg.includes('column');
  if (!missingPhotos) throw je;

  const legacyRows = rows.map((r) => ({
    user_id: r.user_id,
    nombre_oficio: r.nombre_oficio,
    descripcion: r.descripcion,
    foto_url: r.foto_url,
    es_principal: r.es_principal,
  }));
  const { error: je2 } = await supabase.from('jobs').insert(legacyRows);
  if (je2) throw je2;
}

export async function deactivateProfessionalProfileInSupabase(): Promise<void> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const { error } = await sb.rpc('deactivate_professional_profile');
  if (error) throw error;
}

/**
 * Borra la cuenta autenticada con la RPC existente `delete_user_account`
 * (perfil, datos ligados y auth.users). La función también pide limpiar storage.
 */
export async function deleteCurrentUserAccountInSupabase(): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('delete_user_account');
  if (!error) return;
  const msg = (error.message ?? '').toLowerCase();
  if (msg.includes('not_authenticated')) {
    throw new Error('No hay una sesión activa para eliminar la cuenta.');
  }
  throw error;
}

export async function persistProfessionalDescriptionInSupabase(desc: string): Promise<void> {
  const sb = getSupabaseClient();
  const {
    data: { user },
    error: ue,
  } = await sb.auth.getUser();
  if (ue || !user?.id) throw new Error('No hay sesión activa.');
  await writeOwnProfessionalDescription(sb, user.id, desc ?? '');
}

export async function persistWorkerGeoToSupabase(
  baseLocation: { address: string; lat: number; lng: number; completeAddress?: string | null },
  coverageKm: number,
): Promise<void> {
  const supabase = getSupabaseClient();
  const km = Math.max(1, Math.min(300, Math.floor(Number(coverageKm) || 0)));
  const { error } = await supabase.rpc('update_profile_geo_coverage', {
    p_direccion: normalizeDisplayAddress(baseLocation.address),
    p_lat: baseLocation.lat,
    p_lng: baseLocation.lng,
    p_coverage_km: km,
  });
  if (error) throw error;
  await saveExactDireccion(supabase, baseLocation);
}

export async function persistWorkerJobsToSupabase(params: {
  userId: string;
  trades: Array<{
    id: string;
    name: string;
    description: string;
    yearsExperience: number | null;
    isPrimary: boolean;
    proofImageUri?: string;
    proofImageUris?: string[];
  }>;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const storageFolder = await resolveStorageOwnerFolder(params.userId);

  const trimmed = (params.trades ?? [])
    .map((t) => ({
      id: String(t.id ?? ''),
      name: (t.name ?? '').trim(),
      description: (t.description ?? '').trim(),
      yearsExperience:
        t.yearsExperience == null || !Number.isFinite(Number(t.yearsExperience))
          ? null
          : Math.max(1, Math.min(50, Math.floor(Number(t.yearsExperience) || 0))),
      isPrimary: Boolean(t.isPrimary),
      proofImageUri: (t.proofImageUri ?? '').trim() || undefined,
      proofImageUris: Array.isArray(t.proofImageUris)
        ? t.proofImageUris.map((u) => (u ?? '').trim()).filter(Boolean).slice(0, 5)
        : [],
    }))
    .filter((t) => t.name.length > 0)
    .slice(0, 5);

  const wantsPhotos = trimmed.some((t) => Boolean(t.proofImageUri) || t.proofImageUris.length > 0);
  // Versionado por guardado: evita cache de URLs cuando se reemplazan imágenes.
  const version = `v_${Date.now()}`;

  // Si hay fotos, subimos primero y las persistimos vía RPC (SECURITY DEFINER),
  // para evitar RLS en escrituras directas que podrían dejar al worker "sin jobs" (y rompe la búsqueda).
  const jobsForRpc: Array<{
    name: string;
    description: string;
    yearsExperience: number | null;
    isPrimary: boolean;
    photoUrl?: string;
    photoUrls?: string[];
  }> = [];

  for (let idx = 0; idx < trimmed.length; idx++) {
    const t = trimmed[idx]!;
    let uploaded: string[] = [];

    if (wantsPhotos) {
      // Orden esperado: la galería es `proofImageUris` (ya incluye la principal),
      // y `proofImageUri` es solo un atajo. Si metemos ambos, duplicamos la primera.
      const gallery = (t.proofImageUris ?? []).filter(Boolean);
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const u of gallery) {
        if (u && !seen.has(u)) {
          seen.add(u);
          unique.push(u);
        }
      }
      if (t.proofImageUri && !seen.has(t.proofImageUri)) {
        unique.unshift(t.proofImageUri);
      }
      const sources = unique.filter(Boolean).slice(0, 5);

      const uploads: string[] = [];
      for (let p = 0; p < sources.length; p++) {
        const uri = sources[p]!;
        try {
          if (/^https?:\/\//i.test(uri)) {
            uploads.push(uri);
          } else {
            const ext = uri.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
            const path = `${storageFolder}/jobs/${t.id || `job_${idx}`}/${version}/${p}.${ext}`;
            uploads.push(await uploadImageFromUri('job-photos', path, uri, guessMime(uri)));
          }
        } catch (e) {
          console.warn('[persistWorkerJobsToSupabase] foto oficio omitida:', t.name, e);
        }
      }
      uploaded = uploads.slice(0, 5);
    }

    jobsForRpc.push({
      name: t.name,
      description: t.description,
      yearsExperience: t.yearsExperience,
      isPrimary: t.isPrimary || (idx === 0 && !trimmed.some((x) => x.isPrimary)),
      photoUrl: uploaded[0] || undefined,
      photoUrls: uploaded.length ? uploaded : undefined,
    });
  }

  const { error: re } = await supabase.rpc('update_worker_jobs', {
    p_jobs: trimmed.length ? jobsForRpc : null,
  });
  if (!re) return;

  // Último recurso: en instalaciones muy viejas donde la RPC no exista.
  // Intentamos no dejar al usuario sin jobs.
  const { error: de } = await supabase.from('jobs').delete().eq('user_id', params.userId);
  if (de) throw re;
  if (trimmed.length === 0) return;

  const legacyRows = trimmed.map((t, idx) => ({
    user_id: params.userId,
    nombre_oficio: t.name,
    descripcion: t.description,
    foto_url: null,
    es_principal: t.isPrimary || (idx === 0 && !trimmed.some((x) => x.isPrimary)),
  }));
  const { error: ie2 } = await supabase.from('jobs').insert(legacyRows);
  if (ie2) throw re;
}
