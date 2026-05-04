import { getSupabaseClient } from '../lib/supabase';

export type QuoteStatus = 'pending' | 'accepted' | 'rejected' | 'paid';

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
  quote_id?: string | null;
  job_id?: string | null;
  rating: number;
  comment: string;
  created_at: string;
};

export async function fetchConversationParticipants(conversationId: string): Promise<{
  conversation_id: string;
  cliente_id: string;
  trabajador_id: string;
  primary_trade?: string | null;
}> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('conversations')
    .select('id,cliente_id,trabajador_id,primary_trade')
    .eq('id', conversationId)
    .single();
  if (error || !data) throw error ?? new Error('No se pudo cargar la conversación');
  const row = data as any;
  return {
    conversation_id: row.id,
    cliente_id: row.cliente_id,
    trabajador_id: row.trabajador_id,
    primary_trade: row.primary_trade ?? null,
  };
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function computeFinalAmount(netAmount: number, feeRate: number): number {
  const denom = 1 - feeRate;
  if (denom <= 0) return 0;
  // 2 decimales para UI (moneda)
  return Math.round((netAmount / denom) * 100) / 100;
}

export async function fetchQuotesByConversation(conversationId: string): Promise<ChatQuote[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('chat_quotes')
    .select(
      'id,conversation_id,worker_id,client_id,net_amount,fee_rate,final_amount,service_detail,status,accepted_at,rejected_at,paid_at,completed_at,created_at,updated_at,replaces_quote_id',
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.id,
    conversation_id: r.conversation_id,
    worker_id: r.worker_id,
    client_id: r.client_id,
    net_amount: toNum(r.net_amount),
    fee_rate: toNum(r.fee_rate),
    final_amount: toNum(r.final_amount),
    service_detail: String(r.service_detail ?? ''),
    status: r.status as QuoteStatus,
    accepted_at: r.accepted_at ?? null,
    rejected_at: r.rejected_at ?? null,
    paid_at: r.paid_at ?? null,
    completed_at: r.completed_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    replaces_quote_id: r.replaces_quote_id ?? null,
  }));
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
  const sb = getSupabaseClient();
  const feeRate = typeof params.feeRate === 'number' ? params.feeRate : 0.2;
  const finalAmount = computeFinalAmount(params.netAmount, feeRate);
  if (!finalAmount || finalAmount <= 0) throw new Error('Monto inválido');
  const serviceDetail = (params.serviceDetail ?? '').trim();

  const { data, error } = await sb
    .from('chat_quotes')
    .insert({
      conversation_id: params.conversationId,
      worker_id: params.workerId,
      client_id: params.clientId,
      net_amount: params.netAmount,
      fee_rate: feeRate,
      final_amount: finalAmount,
      service_detail: serviceDetail,
      status: 'pending',
      replaces_quote_id: params.replacesQuoteId ?? null,
    })
    .select(
      'id,conversation_id,worker_id,client_id,net_amount,fee_rate,final_amount,service_detail,status,accepted_at,rejected_at,paid_at,completed_at,created_at,updated_at,replaces_quote_id',
    )
    .single();
  if (error || !data) throw error ?? new Error('No se pudo crear la cotización');

  const r = data as any;
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    worker_id: r.worker_id,
    client_id: r.client_id,
    net_amount: toNum(r.net_amount),
    fee_rate: toNum(r.fee_rate),
    final_amount: toNum(r.final_amount),
    service_detail: String(r.service_detail ?? ''),
    status: r.status as QuoteStatus,
    accepted_at: r.accepted_at ?? null,
    rejected_at: r.rejected_at ?? null,
    paid_at: r.paid_at ?? null,
    completed_at: r.completed_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    replaces_quote_id: r.replaces_quote_id ?? null,
  };
}

export async function setQuoteStatus(params: {
  quoteId: string;
  nextStatus: QuoteStatus;
}): Promise<void> {
  const sb = getSupabaseClient();
  const patch: Record<string, unknown> = { status: params.nextStatus };
  const now = new Date().toISOString();
  if (params.nextStatus === 'accepted') patch.accepted_at = now;
  if (params.nextStatus === 'rejected') patch.rejected_at = now;
  if (params.nextStatus === 'paid') patch.paid_at = now;

  const { error } = await sb.from('chat_quotes').update(patch).eq('id', params.quoteId);
  if (error) throw error;
}

export async function markQuoteCompleted(quoteId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('chat_quotes')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', quoteId);
  if (error) throw error;
}

export async function fetchReviewForConversation(conversationId: string): Promise<WorkerReview | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('worker_reviews')
    .select('id,conversation_id,worker_id,client_id,quote_id,job_id,rating,comment,created_at')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  const r = data as any;
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    worker_id: r.worker_id,
    client_id: r.client_id,
    quote_id: r.quote_id ?? null,
    job_id: r.job_id ?? null,
    rating: toNum(r.rating),
    comment: String(r.comment ?? ''),
    created_at: r.created_at,
  };
}

/**
 * Reseña asociada a un Job (1:1). Esta es la forma correcta desde `service_jobs_flow`.
 */
export async function fetchReviewForJob(jobId: string): Promise<WorkerReview | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('worker_reviews')
    .select('id,conversation_id,worker_id,client_id,quote_id,job_id,rating,comment,created_at')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  const r = data as any;
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    worker_id: r.worker_id,
    client_id: r.client_id,
    quote_id: r.quote_id ?? null,
    job_id: r.job_id ?? null,
    rating: toNum(r.rating),
    comment: String(r.comment ?? ''),
    created_at: r.created_at,
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
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('No autenticado');
  const { error } = await sb.from('worker_reviews').insert({
    conversation_id: params.conversationId,
    worker_id: params.workerId,
    client_id: user.id,
    quote_id: params.quoteId ?? null,
    job_id: params.jobId,
    rating: Math.max(1, Math.min(5, Math.round(params.rating))),
    comment: (params.comment ?? '').trim(),
  });
  if (error) throw error;
}

export function subscribeQuotes(conversationId: string, onUpsert: (q: ChatQuote) => void): () => void {
  const sb = getSupabaseClient();
  const channel = sb
    .channel(`chat_quotes:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_quotes',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as any;
        if (!row?.id) return;
        onUpsert({
          id: row.id,
          conversation_id: row.conversation_id,
          worker_id: row.worker_id,
          client_id: row.client_id,
          net_amount: toNum(row.net_amount),
          fee_rate: toNum(row.fee_rate),
          final_amount: toNum(row.final_amount),
          service_detail: String(row.service_detail ?? ''),
          status: row.status as QuoteStatus,
          accepted_at: row.accepted_at ?? null,
          rejected_at: row.rejected_at ?? null,
          paid_at: row.paid_at ?? null,
          completed_at: row.completed_at ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
          replaces_quote_id: row.replaces_quote_id ?? null,
        });
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

