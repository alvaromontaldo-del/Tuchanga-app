import { getSupabaseClient } from '../lib/supabase';

export type JobWorkStatus = 'PENDING' | 'COMPLETED_BY_WORKER';
export type JobPaymentStatus = 'PENDING' | 'PAID';

export type ServiceJob = {
  id: string;
  conversation_id: string;
  quote_id: string;
  worker_id: string;
  client_id: string;
  amount: number;
  description: string;
  work_status: JobWorkStatus;
  payment_status: JobPaymentStatus;
  paid_at: string | null;
  completed_by_worker_at: string | null;
  created_at: string;
  updated_at: string;
};

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapRow(r: any): ServiceJob {
  return {
    id: String(r.id),
    conversation_id: String(r.conversation_id),
    quote_id: String(r.quote_id),
    worker_id: String(r.worker_id),
    client_id: String(r.client_id),
    amount: toNum(r.amount),
    description: String(r.description ?? ''),
    work_status: (r.work_status as JobWorkStatus) ?? 'PENDING',
    payment_status: (r.payment_status as JobPaymentStatus) ?? 'PENDING',
    paid_at: r.paid_at ?? null,
    completed_by_worker_at: r.completed_by_worker_at ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function fetchLatestJobByConversation(conversationId: string): Promise<ServiceJob | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('service_jobs')
    .select(
      'id,conversation_id,quote_id,worker_id,client_id,amount,description,work_status,payment_status,paid_at,completed_by_worker_at,created_at,updated_at',
    )
    .eq('conversation_id', conversationId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}

export function subscribeJobsByConversation(
  conversationId: string,
  onUpsert: (job: ServiceJob) => void,
): () => void {
  const sb = getSupabaseClient();
  const channel = sb
    .channel(`service_jobs:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'service_jobs',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as any;
        if (!row?.id) return;
        onUpsert(mapRow(row));
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export async function acceptQuoteCreateJob(quoteId: string): Promise<string> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('accept_quote', { p_quote_id: quoteId });
  if (error) throw error;
  return String(data);
}

export async function processPayment(jobId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('process_payment', { p_job_id: jobId });
  if (error) throw error;
}

export async function completeJob(jobId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('complete_job', { p_job_id: jobId });
  if (error) throw error;
}

