import { getSupabaseClient } from '../lib/supabase';
import { removeSupabaseRealtimeTopic } from '../lib/supabaseRealtime';
import {
  latestContratacionClosesChat,
  type ClaimChatSnapshot,
} from '../utils/claimChatVisibility';

type ClaimRow = ClaimChatSnapshot & { conversation_id?: string };

/**
 * Conversaciones cuyo hilo debe ocultarse: reclamo iniciado y conformidad
 * de profesional y cliente en la contratación más reciente.
 * Si faltan columnas o la consulta falla, no oculta nada.
 */
export async function fetchClosedClaimChatIds(
  conversationIds: string[],
): Promise<Set<string>> {
  const ids = conversationIds.filter(Boolean);
  if (!ids.length) return new Set();

  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('contrataciones')
    .select(
      'conversation_id, updated_at, created_at, is_claim_open, claim_status, claim_opened_at, claim_marked_done_at, claim_resolved_at',
    )
    .in('conversation_id', ids);

  if (error || !data) return new Set();

  const byConversation = new Map<string, ClaimChatSnapshot[]>();
  for (const raw of data as ClaimRow[]) {
    const conversationId = String(raw.conversation_id ?? '');
    if (!conversationId) continue;
    const list = byConversation.get(conversationId) ?? [];
    list.push({
      is_claim_open: raw.is_claim_open === true ? true : raw.is_claim_open === false ? false : null,
      claim_status: raw.claim_status ?? null,
      claim_opened_at: raw.claim_opened_at ?? null,
      claim_marked_done_at: raw.claim_marked_done_at ?? null,
      claim_resolved_at: raw.claim_resolved_at ?? null,
      updated_at: raw.updated_at ?? null,
      created_at: raw.created_at ?? null,
    });
    byConversation.set(conversationId, list);
  }

  const closed = new Set<string>();
  for (const [conversationId, rows] of byConversation) {
    if (latestContratacionClosesChat(rows)) closed.add(conversationId);
  }
  return closed;
}

/** Avisa si el hilo pasa a cerrado (o se reabre con una contratación nueva). */
export function subscribeClaimChatLock(
  conversationId: string,
  onChange: (closed: boolean) => void,
): () => void {
  const sb = getSupabaseClient();
  const channelName = `claim-chat:${conversationId}`;
  removeSupabaseRealtimeTopic(sb, channelName);

  const refresh = () => {
    void fetchClosedClaimChatIds([conversationId])
      .then((ids) => {
        onChange(ids.has(conversationId));
      })
      .catch(() => {});
  };

  const channel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'contrataciones',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => {
        refresh();
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
