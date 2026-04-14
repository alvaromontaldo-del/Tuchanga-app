import { isSupabaseConfigured } from '../config/supabase';
import {
  fetchConversations,
  fetchMessages,
  findOrCreateConversation,
  type ApiConversation,
  type ApiMessage,
} from './chatApi';
import {
  fetchConversationsSupabase,
  fetchMessagesSupabase,
  findOrCreateConversationSupabase,
  subscribeToConversationMessages,
} from './chatSupabase';

export type { ApiConversation, ApiMessage };

/** Subtítulo del chat según rol: el cliente ve al profesional con oficio; el trabajador ve "Cliente". */
export function buildChatHeaderSubtitle(
  item: Pick<ApiConversation, 'myRole' | 'primaryTrade'>,
): string {
  if (item.myRole === 'cliente') {
    return item.primaryTrade ? `Profesional · ${item.primaryTrade}` : 'Profesional';
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
