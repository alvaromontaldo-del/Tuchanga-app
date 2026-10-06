import { getSupabaseClient } from '../lib/supabase';

/**
 * #120: `profiles.apellido` y `profiles.location` ya no se leen directo de la tabla
 * (cualquier usuario logueado podía pedir el apellido y la ubicación exacta de los
 * profesionales). El propio usuario los pide por RPC y el apellido de otro solo lo
 * recibe el profesional de ese cliente (regla #117: el cliente nunca ve el apellido
 * del profesional).
 */
export type MyProfileIdentity = {
  apellido: string | null;
  lat: number | null;
  lng: number | null;
};

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row as Record<string, unknown>;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Apellido y coordenadas del domicilio del usuario logueado. El RPC solo lee auth.uid(). */
export async function fetchMyProfileIdentity(): Promise<MyProfileIdentity | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('get_my_profile_identity');
  if (error) {
    console.warn('[get_my_profile_identity]', error.message);
    return null;
  }
  const row = firstRow(data);
  if (!row) return null;
  return {
    apellido: textOrNull(row.apellido),
    lat: numOrNull(row.lat),
    lng: numOrNull(row.lng),
  };
}

/**
 * Nombre y apellido del otro participante, para el profesional que habla con su cliente.
 * Si el que pregunta es el cliente, el servidor devuelve el apellido vacío.
 */
export async function fetchPeerFullName(peerId: string): Promise<string | null> {
  if (!peerId) return null;
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('get_peer_display_name', { p_user_id: peerId });
  if (error) {
    console.warn('[get_peer_display_name]', error.message);
    return null;
  }
  const row = firstRow(data);
  if (!row) return null;
  const full = `${textOrNull(row.nombre) ?? ''} ${textOrNull(row.apellido) ?? ''}`.trim();
  return full || null;
}

/**
 * Foto de perfil del otro usuario del chat. Solo `avatar_url`.
 * No lee apellido, domicilio ni otros campos.
 */
export async function fetchPeerAvatarUrl(peerId: string): Promise<string | null> {
  if (!peerId) return null;
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('profiles')
    .select('avatar_url')
    .eq('id', peerId)
    .maybeSingle();
  if (error) return null;
  const url = (data as { avatar_url?: string | null } | null)?.avatar_url;
  const trimmed = typeof url === 'string' ? url.trim() : '';
  return trimmed || null;
}
