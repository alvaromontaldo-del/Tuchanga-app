import { isSupabaseConfigured } from '../config/supabase';
import {
  fetchConversations,
  deleteConversation as deleteConversationApi,
  fetchMessages,
  findOrCreateConversation,
  type ApiConversation,
  type ApiMessage,
} from './chatApi';
import { clearConversationLastRead, loadAllReadsForUser } from './conversationReadsStorage';
import {
  fetchConversationsSupabase,
  deleteConversationSupabase,
  fetchMessagesSupabase,
  fetchTotalUnreadCountSupabase,
  findOrCreateConversationSupabase,
  subscribeToConversationMessages,
} from './chatSupabase';

export type { ApiConversation, ApiMessage };

export function conversationHasUnreadForUser(
  c: ApiConversation,
  myUserId: string,
  reads: Record<string, string>,
): boolean {
  if (!c.lastMessageAt || !c.lastMessageSenderId) return false;
  if (c.lastMessageSenderId === myUserId) return false;
  const readAt = reads[c.id];
  if (!readAt) return true;
  return new Date(c.lastMessageAt) > new Date(readAt);
}

export async function computeHasUnreadMessages(userId: string): Promise<boolean> {
  const [items, reads] = await Promise.all([
    loadConversations(userId),
    loadAllReadsForUser(userId),
  ]);
  return items.some((c) => conversationHasUnreadForUser(c, userId, reads));
}

export async function computeUnreadCountTotal(userId: string): Promise<number> {
  if (isSupabaseConfigured()) {
    try {
      return await fetchTotalUnreadCountSupabase();
    } catch {
      // fallback local aproximado
    }
  }
  const [items, reads] = await Promise.all([
    loadConversations(userId),
    loadAllReadsForUser(userId),
  ]);
  // Modo legacy: no tenemos conteo por mensaje; aproximamos por conversación.
  return items.reduce((acc, c) => acc + (conversationHasUnreadForUser(c, userId, reads) ? 1 : 0), 0);
}

/** Subtítulo del chat según rol: el cliente ve al profesional con oficio; el trabajador ve "Cliente". */
export function buildChatHeaderSubtitle(
  item: Pick<ApiConversation, 'myRole' | 'primaryTrade'>,
): string {
  if (item.myRole === 'cliente') {
    // Identidad por oficio: evitamos "Profesional" genérico.
    return item.primaryTrade?.trim() ? item.primaryTrade.trim() : 'Oficio';
  }
  return 'Cliente';
}

export async function loadConversations(userId: string): Promise<ApiConversation[]> {
  if (isSupabaseConfigured()) {
    return fetchConversationsSupabase();
  }
  return fetchConversations(userId);
}

export async function loadMessages(userId: string, conversationId: string): Promise<ApiMessage[]> {
  if (isSupabaseConfigured()) {
    return fetchMessagesSupabase(conversationId);
  }
  return fetchMessages(userId, conversationId);
}

/**
 * Abre o reutiliza el hilo cliente–trabajador. Solo debe llamarse en flujo "cliente contacta desde perfil":
 * en Supabase la RPC fija `cliente_id = auth.uid()` y deduplica por par (cliente, trabajador).
 */
export async function openOrCreateChat(
  userId: string,
  body: { workerUserId: string; workerDisplayName: string; primaryTrade: string },
): Promise<{ conversationId: string; workerDisplayName: string; primaryTrade: string }> {
  if (isSupabaseConfigured()) {
    return findOrCreateConversationSupabase(body.workerUserId, body.primaryTrade);
  }
  return findOrCreateConversation(userId, body);
}

export function subscribeChatMessages(
  conversationId: string,
  onInsert: (msg: ApiMessage) => void,
  _userId: string,
): () => void {
  if (isSupabaseConfigured()) {
    return subscribeToConversationMessages(conversationId, onInsert);
  }
  return () => {};
}

export async function deleteConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  if (isSupabaseConfigured()) {
    await deleteConversationSupabase(conversationId);
    await clearConversationLastRead(userId, conversationId);
    return;
  }
  await deleteConversationApi(userId, conversationId);
  await clearConversationLastRead(userId, conversationId);
}
