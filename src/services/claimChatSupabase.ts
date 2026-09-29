import { getSupabaseClient } from '../lib/supabase';
import { removeSupabaseRealtimeTopic } from '../lib/supabaseRealtime';
import {
  allLinkedJobsClosedWithoutOpenClaim,
  chatClosedByAllClaimsConformity,
  type ClaimChatSnapshot,
} from '../utils/claimChatVisibility';

type ClaimRow = ClaimChatSnapshot & { conversation_id?: string };

const CLAIM_COLUMNS =
  'conversation_id, updated_at, created_at, estado_trabajo, is_claim_open, claim_status, claim_opened_at, claim_marked_done_at, claim_resolved_at';

function groupClaimRows(data: ClaimRow[]): Map<string, ClaimChatSnapshot[]> {
  const byConversation = new Map<string, ClaimChatSnapshot[]>();
  for (const raw of data) {
    const conversationId = String(raw.conversation_id ?? '');
    if (!conversationId) continue;
    const list = byConversation.get(conversationId) ?? [];
    list.push({
      is_claim_open: raw.is_claim_open === true ? true : raw.is_claim_open === false ? false : null,
      claim_status: raw.claim_status ?? null,
      claim_opened_at: raw.claim_opened_at ?? null,
      claim_marked_done_at: raw.claim_marked_done_at ?? null,
      claim_resolved_at: raw.claim_resolved_at ?? null,
      estado_trabajo: raw.estado_trabajo ?? null,
      updated_at: raw.updated_at ?? null,
      created_at: raw.created_at ?? null,
    });
    byConversation.set(conversationId, list);
  }
  return byConversation;
}

async function loadClaimRows(conversationIds: string[]): Promise<Map<string, ClaimChatSnapshot[]> | null> {
  const ids = conversationIds.filter(Boolean);
  if (!ids.length) return new Map();

  const sb = getSupabaseClient();
  const { data, error } = await sb.from('contrataciones').select(CLAIM_COLUMNS).in('conversation_id', ids);

  if (error || !data) return null;
  return groupClaimRows(data as ClaimRow[]);
}

/**
 * Hilos que salen de Mensajes: todas las contrataciones vinculadas están
 * cerradas y ninguna tiene reclamo abierto o pendiente.
 * Si faltan columnas o la consulta falla, no oculta nada.
 */
export async function fetchSettledJobChatIds(conversationIds: string[]): Promise<Set<string>> {
  const grouped = await loadClaimRows(conversationIds);
  if (!grouped) return new Set();
  const hidden = new Set<string>();
  for (const [conversationId, rows] of grouped) {
    if (allLinkedJobsClosedWithoutOpenClaim(rows)) hidden.add(conversationId);
  }
  return hidden;
}

/**
 * Hilos bloqueados por conformidad de reclamo. Exige que todas las
 * contrataciones estén cerradas sin reclamo abierto y que alguna haya
 * llegado a conformidad de las dos partes.
 */
export async function fetchClosedClaimChatIds(conversationIds: string[]): Promise<Set<string>> {
  const grouped = await loadClaimRows(conversationIds);
  if (!grouped) return new Set();
  const closed = new Set<string>();
  for (const [conversationId, rows] of grouped) {
    if (chatClosedByAllClaimsConformity(rows)) closed.add(conversationId);
  }
  return closed;
}

/** Avisa si el hilo pasa a cerrado por conformidad (o se reabre). */
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
