import type { ApiConversation } from './chatApi';

export type InboxMessageEvent = {
  type: 'message';
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  messageId?: string;
  /** Rellenado por InboxContext tras el parche optimista. */
  conversationUnread?: number;
  totalUnread?: number;
};

export type InboxReadEvent = {
  type: 'read';
  conversationId: string;
  userId: string;
  readAt: string;
};

/** `conversations.updated_at` cambió (trigger al insertar mensaje). */
export type InboxConversationActivityEvent = {
  type: 'conversation_activity';
  conversationId: string;
};

export type InboxRealtimeEvent =
  | InboxMessageEvent
  | InboxReadEvent
  | InboxConversationActivityEvent;

export type InboxState = {
  unreadByConversationId: Record<string, number>;
  readAtByConversationId: Record<string, string>;
};

export function emptyInboxState(): InboxState {
  return { unreadByConversationId: {}, readAtByConversationId: {} };
}

export function totalUnreadFromState(state: InboxState): number {
  return Object.values(state.unreadByConversationId).reduce((n, v) => n + Math.max(0, v), 0);
}

export function hydrateInboxFromConversations(conversations: ApiConversation[]): InboxState {
  const unreadByConversationId: Record<string, number> = {};
  for (const c of conversations) {
    unreadByConversationId[c.id] = Math.max(0, c.unreadCount ?? 0);
  }
  return { unreadByConversationId, readAtByConversationId: {} };
}

export function mergeLocalReads(
  state: InboxState,
  localReads: Record<string, string>,
  userId: string,
  conversations: ApiConversation[],
): InboxState {
  const readAtByConversationId = { ...state.readAtByConversationId, ...localReads };
  const unreadByConversationId = { ...state.unreadByConversationId };

  for (const c of conversations) {
    const readAt = readAtByConversationId[c.id];
    if (!readAt || !c.lastMessageAt || c.lastMessageSenderId === userId) {
      if (c.lastMessageSenderId === userId) unreadByConversationId[c.id] = 0;
      continue;
    }
    if (new Date(c.lastMessageAt) <= new Date(readAt)) {
      unreadByConversationId[c.id] = 0;
    }
  }

  return { unreadByConversationId, readAtByConversationId };
}

export function applyInboxMessage(
  state: InboxState,
  userId: string,
  event: InboxMessageEvent,
  options?: { activeConversationId?: string | null; skipUnread?: boolean },
): InboxState {
  const readAtByConversationId = { ...state.readAtByConversationId };
  const unreadByConversationId = { ...state.unreadByConversationId };

  const isMine = event.senderId === userId;
  const isActive = options?.activeConversationId === event.conversationId;

  if (isActive || options?.skipUnread) {
    readAtByConversationId[event.conversationId] = event.createdAt;
    unreadByConversationId[event.conversationId] = 0;
  } else if (!isMine) {
    const prevRead = readAtByConversationId[event.conversationId];
    const alreadyRead =
      prevRead && new Date(event.createdAt).getTime() <= new Date(prevRead).getTime();
    if (!alreadyRead) {
      unreadByConversationId[event.conversationId] =
        (unreadByConversationId[event.conversationId] ?? 0) + 1;
    }
  } else {
    unreadByConversationId[event.conversationId] = 0;
  }

  return { unreadByConversationId, readAtByConversationId };
}

export function applyInboxMarkRead(
  state: InboxState,
  conversationId: string,
  readAt: string,
): InboxState {
  return {
    readAtByConversationId: {
      ...state.readAtByConversationId,
      [conversationId]: readAt,
    },
    unreadByConversationId: {
      ...state.unreadByConversationId,
      [conversationId]: 0,
    },
  };
}

/** Parche optimista de una fila en la lista de conversaciones. */
export function patchConversationRow(
  row: ApiConversation,
  event: InboxMessageEvent,
  userId: string,
  unreadCount: number,
): ApiConversation {
  return {
    ...row,
    lastMessage: event.body,
    lastMessageAt: event.createdAt,
    lastMessageSenderId: event.senderId,
    unreadCount,
    updatedAt: event.createdAt,
  };
}

export function sortConversations(rows: ApiConversation[]): ApiConversation[] {
  return [...rows].sort(
    (a, b) =>
      new Date(b.lastMessageAt ?? b.updatedAt).getTime() -
      new Date(a.lastMessageAt ?? a.updatedAt).getTime(),
  );
}

/**
 * Reconciliación con servidor sin pisar un contador optimista más reciente.
 */
export function mergeInboxWithServer(local: InboxState, server: InboxState): InboxState {
  const unreadByConversationId = { ...server.unreadByConversationId };
  const allIds = new Set([
    ...Object.keys(local.unreadByConversationId),
    ...Object.keys(server.unreadByConversationId),
  ]);
  for (const id of allIds) {
    const localN = local.unreadByConversationId[id] ?? 0;
    const serverN = server.unreadByConversationId[id] ?? 0;
    const localRead = local.readAtByConversationId[id];
    // Si el usuario marcó leído localmente, no dejar que el servidor “reviva” el badge.
    if (localRead && localN === 0) {
      unreadByConversationId[id] = 0;
    } else {
      unreadByConversationId[id] = Math.max(localN, serverN);
    }
  }

  const readAtByConversationId = { ...server.readAtByConversationId };
  for (const [id, localRead] of Object.entries(local.readAtByConversationId)) {
    const serverRead = readAtByConversationId[id];
    if (!serverRead || new Date(localRead).getTime() >= new Date(serverRead).getTime()) {
      readAtByConversationId[id] = localRead;
    }
  }

  return { unreadByConversationId, readAtByConversationId };
}

export function applyInboxSyncLight(
  state: InboxState,
  payload: {
    unreadByConversationId: Record<string, number>;
    readAtByConversationId?: Record<string, string>;
  },
): InboxState {
  return mergeInboxWithServer(state, {
    unreadByConversationId: payload.unreadByConversationId,
    readAtByConversationId: payload.readAtByConversationId ?? state.readAtByConversationId,
  });
}
