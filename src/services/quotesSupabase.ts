import {
  crearCotizacion,
  fetchContratacionById,
  fetchContratacionesByConversation,
  rechazarPrecioCotizado,
  subscribeContratacionesByConversation,
  computeFinalAmount,
} from './contratacionesSupabase';
import type { Contratacion } from '../types/contrataciones';
import { COMISION_APP_RATE } from '../types/contrataciones';

export type QuoteStatus = 'pending' | 'accepted' | 'rejected' | 'seña_pagada' | 'paid';

export type ChatQuote = {
  id: string;
  conversation_id: string;
  worker_id: string;
  client_id: string;
  net_amount: number;
  fee_rate: number;
  final_amount: number;
  service_detail: string;
  status: QuoteStatus;
  accepted_at: string | null;
  rejected_at: string | null;
  paid_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  replaces_quote_id: string | null;
};

export type WorkerReview = {
  id: string;
  conversation_id: string;
  worker_id: string;
  client_id: string;
  job_id?: string | null;
  rating: number;
  comment: string;
  created_at: string;
};

export { COMISION_APP_RATE, computeFinalAmount };

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Presupuesto provisional desde metadata del mensaje (mientras llega el realtime de contrataciones). */
export function chatQuoteFromMessageMetadata(
  item: {
    metadata?: Record<string, unknown>;
    conversation_id?: string;
    created_at?: string;
    text?: string;
  },
  conversationId: string,
): ChatQuote | null {
  const meta = item.metadata ?? {};
  const id = String(meta.quoteId ?? meta.contratacion_id ?? '');
  if (!id) return null;
  const precioFinal = toNum(meta.precio_final);
  const precioTrabajador = toNum(meta.precio_trabajador);
  if (precioFinal <= 0 && precioTrabajador <= 0) return null;
  const netAmount = precioTrabajador > 0 ? precioTrabajador : precioFinal / (1 + COMISION_APP_RATE);
  const finalAmount = precioFinal > 0 ? precioFinal : computeFinalAmount(netAmount, COMISION_APP_RATE);
  const detail =
    typeof meta.service_detail === 'string' && meta.service_detail.trim()
      ? meta.service_detail.trim()
      : String(item.text ?? '').trim();

  return {
    id,
    conversation_id: conversationId,
    worker_id: typeof meta.worker_id === 'string' ? meta.worker_id : '',
    client_id: typeof meta.client_id === 'string' ? meta.client_id : '',
    net_amount: netAmount,
    fee_rate: COMISION_APP_RATE,
    final_amount: finalAmount,
    service_detail: detail,
    status: 'pending',
    accepted_at: null,
    rejected_at: null,
    paid_at: null,
    completed_at: null,
    created_at: item.created_at ?? new Date().toISOString(),
    updated_at: item.created_at ?? new Date().toISOString(),
    replaces_quote_id: null,
  };
}

export function contratacionToChatQuote(c: Contratacion): ChatQuote {
  let status: QuoteStatus = 'accepted';
  if (c.estado_trabajo === 'cancelado') status = 'rejected';
  else if (c.estado_trabajo === 'precio_cotizado') status = 'pending';
  else if (c.estado_pago === 'totalmente_pagado') status = 'paid';
  else if (c.estado_pago === 'seña_pagada') status = 'seña_pagada';

  return {
    id: c.id,
    conversation_id: c.conversation_id,
    worker_id: c.worker_id,
    client_id: c.client_id,
    net_amount: c.precio_trabajador,
    fee_rate: COMISION_APP_RATE,
    final_amount: c.precio_final,
    service_detail: c.service_detail,
    status,
    accepted_at:
      c.estado_trabajo !== 'precio_cotizado' && c.estado_trabajo !== 'cancelado'
        ? c.updated_at
        : null,
    rejected_at: c.cancelado_at,
    paid_at: c.seña_pagada_at ?? c.paid_at,
    completed_at: c.finalizado_at ?? c.completed_by_worker_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
    replaces_quote_id: null,
  };
}

export async function fetchConversationParticipants(conversationId: string): Promise<{
  conversation_id: string;
  cliente_id: string;
  trabajador_id: string;
  primary_trade?: string | null;
} | null> {
  const { getSupabaseClient } = await import('../lib/supabase');
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return null;

  const { data, error } = await sb
    .from('conversations')
    .select('id,cliente_id,trabajador_id,primary_trade')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string;
    cliente_id: string;
    trabajador_id: string;
    primary_trade?: string | null;
  };
  if (row.cliente_id !== user.id && row.trabajador_id !== user.id) {
    return null;
  }
  return {
    conversation_id: row.id,
    cliente_id: row.cliente_id,
    trabajador_id: row.trabajador_id,
    primary_trade: row.primary_trade ?? null,
  };
}

export async function fetchQuotesByConversation(conversationId: string): Promise<ChatQuote[]> {
  const rows = await fetchContratacionesByConversation(conversationId);
  return rows.map(contratacionToChatQuote);
}

export async function createQuote(params: {
  conversationId: string;
  workerId: string;
  clientId: string;
  netAmount: number;
  feeRate?: number;
  serviceDetail?: string;
  replacesQuoteId?: string | null;
}): Promise<ChatQuote> {
  void params.workerId;
  void params.clientId;
  void params.feeRate;
  void params.replacesQuoteId;

  const net = Math.max(0, Math.ceil(Number(params.netAmount) || 0));
  if (net <= 0) throw new Error('Monto inválido');
  const detail = (params.serviceDetail ?? '').trim();
  if (!detail) throw new Error('El detalle del servicio es obligatorio.');

  const id = await crearCotizacion({
    conversationId: params.conversationId,
    precioTrabajador: net,
    serviceDetail: detail,
  });

  const row = await fetchContratacionById(id);
  if (!row) throw new Error('No se pudo crear la cotización');
  return contratacionToChatQuote(row);
}

/** @deprecated Usar rechazarPrecioCotizado en contratacionesSupabase */
export async function setQuoteStatus(params: {
  quoteId: string;
  nextStatus: QuoteStatus;
}): Promise<void> {
  if (params.nextStatus === 'rejected') {
    await rechazarPrecioCotizado(params.quoteId);
    return;
  }
  throw new Error(`setQuoteStatus(${params.nextStatus}) no soportado; usar RPCs de contrataciones`);
}

/** @deprecated El cierre se gestiona vía trabajador_finalizar_trabajo */
export async function markQuoteCompleted(_quoteId: string): Promise<void> {
  throw new Error('markQuoteCompleted está obsoleto');
}

export async function fetchReviewForConversation(conversationId: string): Promise<WorkerReview | null> {
  const { getSupabaseClient } = await import('../lib/supabase');
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('worker_reviews')
    .select('id,conversation_id,worker_id,client_id,job_id,rating,comment,created_at')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    conversation_id: String(r.conversation_id),
    worker_id: String(r.worker_id),
    client_id: String(r.client_id),
    job_id: (r.job_id as string | null) ?? null,
    rating: toNum(r.rating),
    comment: String(r.comment ?? ''),
    created_at: String(r.created_at),
  };
}

export async function fetchReviewForJob(jobId: string): Promise<WorkerReview | null> {
  const { getSupabaseClient } = await import('../lib/supabase');
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('worker_reviews')
    .select('id,conversation_id,worker_id,client_id,job_id,rating,comment,created_at')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    conversation_id: String(r.conversation_id),
    worker_id: String(r.worker_id),
    client_id: String(r.client_id),
    job_id: (r.job_id as string | null) ?? null,
    rating: toNum(r.rating),
    comment: String(r.comment ?? ''),
    created_at: String(r.created_at),
  };
}

export async function createReview(params: {
  conversationId: string;
  workerId: string;
  quoteId?: string | null;
  jobId: string;
  rating: number;
  comment: string;
}): Promise<void> {
  void params.quoteId;
  const { getSupabaseClient } = await import('../lib/supabase');
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('No autenticado');
  const { data: inserted, error } = await sb
    .from('worker_reviews')
    .insert({
      conversation_id: params.conversationId,
      worker_id: params.workerId,
      client_id: user.id,
      job_id: params.jobId,
      rating: Math.max(1, Math.min(5, Math.round(params.rating))),
      comment: (params.comment ?? '').trim(),
    })
    .select('id')
    .single();
  if (error) throw error;

  // Push al trabajador (misma forma de payload que Database Webhook → push_on_review).
  try {
    const { error: pushErr } = await sb.functions.invoke('push_on_review', {
      body: {
        type: 'INSERT',
        table: 'worker_reviews',
        schema: 'public',
        record: {
          id: inserted?.id,
          conversation_id: params.conversationId,
          worker_id: params.workerId,
          client_id: user.id,
          job_id: params.jobId,
          rating: Math.max(1, Math.min(5, Math.round(params.rating))),
          comment: (params.comment ?? '').trim(),
        },
        old_record: null,
      },
    });
    if (pushErr) {
      console.warn('[push_on_review]', pushErr.message ?? pushErr);
    }
  } catch (e) {
    console.warn('[push_on_review]', e);
  }

  // Si el pago ya fue confirmado → ocultar chat + purgar imágenes (retención 0 hoy)
  const { requestChatCleanupAfterJobComplete } = await import('./chatCleanupSupabase');
  void requestChatCleanupAfterJobComplete(params.jobId);
}

export function subscribeQuotes(conversationId: string, onUpsert: (q: ChatQuote) => void): () => void {
  return subscribeContratacionesByConversation(conversationId, (row) => {
    onUpsert(contratacionToChatQuote(row));
  });
}

export { rechazarPrecioCotizado } from './contratacionesSupabase';
