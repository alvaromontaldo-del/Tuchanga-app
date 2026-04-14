import { getApiBaseUrl } from '../config/api';

export type ConversationRole = 'cliente' | 'trabajador';

export type ApiConversation = {
  id: string;
  otherUserId: string;
  otherDisplayName: string;
  primaryTrade: string;
  lastMessage: string | null;
  updatedAt: string;
  /** Rol del usuario actual en este hilo (para copys y cabecera del chat). */
  myRole: ConversationRole;
};

export type ApiMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  status: string;
  created_at: string;
  clientMessageId?: string | null;
};

function authHeaders(userId: string) {
  return {
    Authorization: `Bearer ${userId}`,
    'Content-Type': 'application/json',
  } as const;
}

export async function fetchConversations(userId: string): Promise<ApiConversation[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/conversations`, {
    headers: authHeaders(userId),
  });
  if (!res.ok) throw new Error(`conversations ${res.status}`);
  const data = (await res.json()) as { conversations: ApiConversation[] };
  return data.conversations ?? [];
}

export async function fetchMessages(
  userId: string,
  conversationId: string,
): Promise<ApiMessage[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/messages/${conversationId}`, {
    headers: authHeaders(userId),
  });
  if (!res.ok) throw new Error(`messages ${res.status}`);
  const data = (await res.json()) as { messages: ApiMessage[] };
  return data.messages ?? [];
}

export async function findOrCreateConversation(
  userId: string,
  body: {
    workerUserId: string;
    workerDisplayName: string;
    primaryTrade: string;
  },
): Promise<{ conversationId: string; workerDisplayName: string; primaryTrade: string }> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/conversations/find-or-create`, {
    method: 'POST',
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `find-or-create ${res.status}`);
  }
  return res.json() as Promise<{
    conversationId: string;
    workerDisplayName: string;
    primaryTrade: string;
  }>;
}
