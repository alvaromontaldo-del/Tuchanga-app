import { getSupabaseClient } from '../lib/supabase';
import { jobAddressWriteRejection, type JobAddressRejection } from '../utils/jobAddressCard';

export type ConversationJobAddress = {
  text: string | null;
  lat: number | null;
  lng: number | null;
  confirmedAt: string | null;
};

function rowOf(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row as Record<string, unknown>;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function coordOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return n;
}

export function isMissingJobAddressRpc(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  if (code === 'PGRST202' || code === '42883' || code === '42P01' || code === 'PGRST205') return true;
  return (
    msg.includes('could not find') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('conversation_job_address') ||
    msg.includes('set_conversation_job_address') ||
    msg.includes('confirm_conversation_job_address')
  );
}

export function jobAddressErrorCode(message: string | undefined): JobAddressRejection | 'unavailable' | null {
  const msg = message ?? '';
  if (/not_conversation_client|not authenticated/i.test(msg)) return 'not_client';
  if (/job_address_locked_after_payment/i.test(msg)) return 'paid';
  if (/invalid_job_address/i.test(msg)) return 'invalid';
  return null;
}

export function jobAddressErrorMessage(code: JobAddressRejection | 'unavailable'): string {
  if (code === 'not_client') return 'Solo el cliente de este chat puede indicar la dirección.';
  if (code === 'paid') return 'Después del pago no se puede cambiar la dirección de este trabajo.';
  if (code === 'invalid') return 'Elegí la dirección en el mapa. Tiene que ser un punto real.';
  return 'Todavía no se puede guardar la dirección de este trabajo.';
}

/**
 * Dirección de ESTE trabajo, solo para el cliente (RLS).
 * No trae la fila si quien pregunta es el profesional.
 */
export async function fetchMyConversationJobAddress(
  conversationId: string,
): Promise<ConversationJobAddress | null> {
  const id = conversationId.trim();
  if (!id) return null;
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('conversation_job_address')
    .select('job_address_text, job_lat, job_lng, job_address_confirmed_at')
    .eq('conversation_id', id)
    .maybeSingle();
  if (error) {
    if (isMissingJobAddressRpc(error)) return null;
    throw error;
  }
  const row = rowOf(data);
  if (!row) return null;
  const lat = coordOrNull(row.job_lat);
  const lng = coordOrNull(row.job_lng);
  return {
    text: textOrNull(row.job_address_text),
    lat: lat === 0 && lng === 0 ? null : lat,
    lng: lat === 0 && lng === 0 ? null : lng,
    confirmedAt: textOrNull(row.job_address_confirmed_at),
  };
}

export async function setConversationJobAddress(input: {
  conversationId: string;
  text: string;
  lat: number;
  lng: number;
  alsoProfile: boolean;
}): Promise<void> {
  const rejection = jobAddressWriteRejection({
    isClient: true,
    deleted: false,
    paid: false,
    text: input.text,
    lat: input.lat,
    lng: input.lng,
  });
  if (rejection) {
    throw new Error(jobAddressErrorMessage(rejection));
  }
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('set_conversation_job_address', {
    p_conversation_id: input.conversationId,
    p_texto: input.text.trim(),
    p_lat: input.lat,
    p_lng: input.lng,
    p_also_profile: input.alsoProfile,
  });
  if (!error) return;
  if (isMissingJobAddressRpc(error)) {
    throw new Error(jobAddressErrorMessage('unavailable'));
  }
  const code = jobAddressErrorCode(error.message);
  throw new Error(jobAddressErrorMessage(code ?? 'unavailable'));
}

export async function confirmConversationJobAddress(conversationId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('confirm_conversation_job_address', {
    p_conversation_id: conversationId,
  });
  if (!error) return;
  if (isMissingJobAddressRpc(error)) {
    throw new Error(jobAddressErrorMessage('unavailable'));
  }
  const code = jobAddressErrorCode(error.message);
  throw new Error(jobAddressErrorMessage(code ?? 'unavailable'));
}
