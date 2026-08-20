import { getSupabaseClient } from '../lib/supabase';
import {
  isMercadoPagoEnabled,
  mapMpCheckoutError,
  type MpCheckoutResult,
  type MpCheckoutErrorCode,
} from '../config/mercadoPago';
import { fetchContratacionById } from './contratacionesSupabase';

export { isMercadoPagoEnabled };

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

export async function crearPreferenciaSeña(
  contratacionId: string,
): Promise<{ ok: true; data: MpCheckoutResult } | { ok: false; code: MpCheckoutErrorCode; message: string }> {
  if (!isMercadoPagoEnabled()) {
    return { ok: false, code: 'mp_not_configured', message: 'MercadoPago no está habilitado en la app.' };
  }

  const sb = getSupabaseClient();
  const { data, error } = await sb.functions.invoke('mp_crear_preferencia', {
    body: { contratacion_id: contratacionId },
  });

  if (error) {
    const payload = await readInvokePayload(error);
    const code = mapMpCheckoutError(payload);
    const msg =
      typeof payload === 'object' && payload && 'detail' in payload
        ? String((payload as { detail?: string }).detail ?? error.message)
        : error.message;
    return { ok: false, code, message: msg || 'No se pudo iniciar el pago.' };
  }

  const result = data as MpCheckoutResult;
  if (!result?.checkout_url) {
    return { ok: false, code: 'unknown', message: 'Respuesta de pago inválida.' };
  }

  return { ok: true, data: result };
}

export async function crearPreferenciaCostoServicioMateriales(
  orderId: string,
): Promise<{ ok: true; data: MpCheckoutResult } | { ok: false; code: MpCheckoutErrorCode; message: string }> {
  if (!isMercadoPagoEnabled()) {
    return { ok: false, code: 'mp_not_configured', message: 'MercadoPago no está habilitado en la app.' };
  }

  const sb = getSupabaseClient();
  const { data, error } = await sb.functions.invoke('mp_crear_preferencia', {
    body: { order_id: orderId },
  });

  if (error) {
    const payload = await readInvokePayload(error);
    const code = mapMpCheckoutError(payload);
    const msg =
      typeof payload === 'object' && payload && 'detail' in payload
        ? String((payload as { detail?: string }).detail ?? error.message)
        : error.message;
    return { ok: false, code, message: msg || 'No se pudo iniciar el pago.' };
  }

  const result = data as MpCheckoutResult;
  if (!result?.checkout_url) {
    return { ok: false, code: 'unknown', message: 'Respuesta de pago inválida.' };
  }

  return { ok: true, data: result };
}

/** @deprecated Usar crearPreferenciaCostoServicioMateriales. */
export const crearPreferenciaSeñaMateriales = crearPreferenciaCostoServicioMateriales;

export type ConfirmarSeñaResult = {
  ok: boolean;
  estado_pago?: string;
  already_paid?: boolean;
  message?: string;
};

export async function confirmarSeñaMercadoPago(
  contratacionId: string,
  mpPaymentId?: string,
): Promise<ConfirmarSeñaResult> {
  if (!isMercadoPagoEnabled()) {
    return { ok: false, message: 'MercadoPago no está habilitado.' };
  }

  const existing = await fetchContratacionById(contratacionId);
  if (
    existing?.estado_pago === 'seña_pagada' ||
    existing?.estado_pago === 'totalmente_pagado'
  ) {
    return { ok: true, estado_pago: existing.estado_pago, already_paid: true };
  }

  const sb = getSupabaseClient();
  const { data, error } = await sb.functions.invoke('mp_confirmar_sena', {
    body: {
      contratacion_id: contratacionId,
      ...(mpPaymentId ? { mp_payment_id: mpPaymentId } : {}),
    },
  });

  if (error) {
    const payload = await readInvokePayload(error);
    const msg =
      typeof payload === 'object' && payload
        ? String(
            (payload as { detail?: string; error?: string; message?: string }).detail ??
              (payload as { message?: string }).message ??
              (payload as { error?: string }).error ??
              error.message,
          )
        : error.message;
    return { ok: false, message: msg || 'No se pudo confirmar el pago.' };
  }

  const result = data as ConfirmarSeñaResult & { mp_status?: string };
  if (result?.ok) return result;
  return {
    ok: false,
    message: result?.message ?? 'Pago aún no acreditado.',
    estado_pago: result?.estado_pago,
  };
}

export async function confirmarCostoServicioMaterialesMp(
  orderId: string,
  mpPaymentId?: string,
): Promise<ConfirmarSeñaResult> {
  if (!isMercadoPagoEnabled()) {
    return { ok: false, message: 'MercadoPago no está habilitado.' };
  }

  const sb = getSupabaseClient();
  const { data, error } = await sb.functions.invoke('mp_confirmar_sena', {
    body: {
      order_id: orderId,
      ...(mpPaymentId ? { mp_payment_id: mpPaymentId } : {}),
    },
  });

  if (error) {
    const payload = await readInvokePayload(error);
    const msg =
      typeof payload === 'object' && payload
        ? String(
            (payload as { detail?: string; error?: string; message?: string }).detail ??
              (payload as { message?: string }).message ??
              (payload as { error?: string }).error ??
              error.message,
          )
        : error.message;
    return { ok: false, message: msg || 'No se pudo confirmar el pago.' };
  }

  const result = data as ConfirmarSeñaResult & { mp_status?: string };
  if (result?.ok) return result;
  return {
    ok: false,
    message: result?.message ?? 'Pago aún no acreditado.',
    estado_pago: result?.estado_pago,
  };
}

/** @deprecated Usar confirmarCostoServicioMaterialesMp. */
export const confirmarSeñaMaterialesMercadoPago = confirmarCostoServicioMaterialesMp;

/** Sincroniza seña con MP si el cliente ya pagó pero el estado local sigue pendiente. */
export async function sincronizarSeñaSiPendiente(contratacionId: string): Promise<boolean> {
  const row = await fetchContratacionById(contratacionId);
  if (!row) return false;
  if (row.estado_pago === 'seña_pagada' || row.estado_pago === 'totalmente_pagado') {
    return true;
  }
  if (row.estado_pago !== 'pendiente_seña') return false;
  const result = await confirmarSeñaMercadoPago(contratacionId);
  return result.ok;
}

export function parsePagoRetornoUrl(url: string): {
  status: 'approved' | 'pending' | 'failure' | 'unknown';
  contratacionId?: string;
  materialOrderId?: string;
  mpPaymentId?: string;
} {
  try {
    const normalized = url.includes('://') ? url : `scheme://${url}`;
    const u = new URL(normalized.replace(/^([a-z0-9-]+):\/\//i, 'app://'));
    const statusRaw = (
      u.searchParams.get('status') ??
      u.searchParams.get('collection_status') ??
      u.searchParams.get('yc_status') ??
      ''
    ).toLowerCase();
    const status =
      statusRaw === 'approved' || statusRaw === 'success'
        ? 'approved'
        : statusRaw === 'pending' || statusRaw === 'in_process'
          ? 'pending'
          : statusRaw === 'failure' || statusRaw === 'rejected'
            ? 'failure'
            : 'unknown';
    const contratacionId = u.searchParams.get('contratacion_id') ?? undefined;
    const materialOrderId =
      u.searchParams.get('material_order_id') ?? u.searchParams.get('order_id') ?? undefined;
    const mpPaymentId =
      u.searchParams.get('payment_id') ??
      u.searchParams.get('collection_id') ??
      undefined;
    return { status, contratacionId, materialOrderId, mpPaymentId };
  } catch {
    if (url.includes('pagos/retorno')) {
      const mpPaymentId = url.match(/[?&](?:payment_id|collection_id)=(\d+)/i)?.[1];
      const materialOrderId = url.match(/[?&](?:material_order_id|order_id)=([0-9a-f-]{36})/i)?.[1];
      if (url.includes('approved') || url.includes('success')) {
        return { status: 'approved', mpPaymentId, materialOrderId };
      }
      if (url.includes('pending')) return { status: 'pending', mpPaymentId, materialOrderId };
      if (url.includes('failure')) return { status: 'failure', mpPaymentId, materialOrderId };
    }
    return { status: 'unknown' };
  }
}
