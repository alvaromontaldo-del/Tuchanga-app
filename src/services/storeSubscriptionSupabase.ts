import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import {
  clampTrialDays,
  DEFAULT_TRIAL_DAYS,
  parseStoreSubscription,
  type StoreSubscriptionSnapshot,
} from '../utils/storeSubscription';

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const msg = String((error as { message?: unknown }).message ?? '').trim();
    if (msg) return msg;
  }
  return fallback;
}

async function readInvokePayload(error: unknown): Promise<unknown> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      return await ctx.json();
    } catch {
      return null;
    }
  }
  return null;
}

function payloadMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const row = payload as Record<string, unknown>;
  return typeof row.message === 'string' ? row.message.trim() : '';
}

export async function fetchStoreTrialDays(): Promise<number> {
  const snapshot = await fetchMyStoreSubscription();
  return snapshot?.trialDays ?? DEFAULT_TRIAL_DAYS;
}

export async function fetchMyStoreSubscription(): Promise<StoreSubscriptionSnapshot | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.rpc('get_my_store_subscription');
    if (error) return null;
    const parsed = parseStoreSubscription(data);
    if (!parsed) return null;
    return { ...parsed, trialDays: clampTrialDays(parsed.trialDays) };
  } catch {
    return null;
  }
}

export async function startStoreSubscriptionCheckout(storeId: string): Promise<string> {
  const id = storeId.trim();
  if (!id) throw new Error('No encontramos tu comercio.');
  if (!isSupabaseConfigured()) throw new Error('Supabase no está configurado.');

  const sb = getSupabaseClient();
  const { data, error } = await sb.functions.invoke('mp_crear_suscripcion', {
    body: { store_id: id },
  });
  if (error) {
    const payload = await readInvokePayload(error);
    const message =
      payloadMessage(payload) ||
      errorMessage(error, 'No se pudo abrir el débito automático.');
    throw new Error(message);
  }
  const url =
    data && typeof data === 'object' && typeof (data as { checkout_url?: unknown }).checkout_url === 'string'
      ? (data as { checkout_url: string }).checkout_url.trim()
      : '';
  if (!url) throw new Error('Mercado Pago no devolvió el checkout de prueba.');
  return url;
}
