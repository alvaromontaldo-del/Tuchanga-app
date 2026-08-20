import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { isMessagingAvailable } from '../config/api';
import { isSupabaseConfigured } from '../config/supabase';
import {
  applyInboxMarkRead,
  applyInboxMessage,
  applyInboxSyncLight,
  emptyInboxState,
  hydrateInboxFromConversations,
  mergeInboxWithServer,
  mergeLocalReads,
  totalUnreadFromState,
  type InboxMessageEvent,
  type InboxRealtimeEvent,
  type InboxState,
} from '../services/inboxState';
import { loadAllReadsForUser, setConversationLastRead } from '../services/conversationReadsStorage';
import { upsertConversationRead } from '../services/conversationReadsSupabase';
import { fetchConversationSnippet, fetchInboxSyncLight } from '../services/inboxSyncSupabase';
import { loadConversations, subscribeInboxRealtime } from '../services/messaging';
import { useAuth } from './AuthContext';

type InboxListener = (event: InboxRealtimeEvent) => void;

type UnreadMessagesContextValue = {
  hasUnreadMessages: boolean;
  unreadCount: number;
  unreadByConversationId: Readonly<Record<string, number>>;
  inboxRevision: number;
  markConversationRead: (conversationId: string, readAtIso?: string) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  /** Respaldo si el canal inbox llega tarde (p. ej. chat abierto con canal por conversación). */
  ingestInboxMessage: (event: InboxMessageEvent) => void;
  onInboxEvent: (listener: InboxListener) => () => void;
  /** RPC liviano; usar con la pestaña Mensajes visible si Realtime falla. */
  syncInboxLight: () => Promise<void>;
  reconcileInboxFromServer: (options?: { force?: boolean }) => Promise<void>;
};

const UnreadMessagesContext = createContext<UnreadMessagesContextValue | null>(null);

/** No pisar estado optimista recién actualizado por Realtime. */
const RECONCILE_COOLDOWN_MS = 6_000;
const MARK_READ_GUARD_MS = 12_000;
const SEEN_MESSAGE_IDS_MAX = 120;

export function UnreadMessagesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [inboxState, setInboxState] = useState<InboxState>(emptyInboxState);
  const [inboxRevision, setInboxRevision] = useState(0);
  const inboxStateRef = useRef<InboxState>(emptyInboxState());
  const activeConversationIdRef = useRef<string | null>(null);
  const listenersRef = useRef<Set<InboxListener>>(new Set());
  const mounted = useRef(true);
  const reconcileInFlightRef = useRef(false);
  const lastRealtimeMsRef = useRef(0);
  const lastMarkReadMsRef = useRef(0);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const lightSyncInFlightRef = useRef(false);

  const messageDedupeKey = useCallback((conversationId: string, createdAt: string) => {
    return `${conversationId}:${createdAt}`;
  }, []);

  const isMessageAlreadySeen = useCallback(
    (conversationId: string, createdAt: string, messageId?: string) => {
      const seen = seenMessageIdsRef.current;
      if (messageId && seen.has(messageId)) return true;
      return seen.has(messageDedupeKey(conversationId, createdAt));
    },
    [messageDedupeKey],
  );

  const registerMessageSeen = useCallback(
    (conversationId: string, createdAt: string, messageId?: string) => {
      const seen = seenMessageIdsRef.current;
      seen.add(messageDedupeKey(conversationId, createdAt));
      if (messageId) seen.add(messageId);
      if (seen.size > SEEN_MESSAGE_IDS_MAX) {
        const drop = [...seen].slice(0, seen.size - SEEN_MESSAGE_IDS_MAX);
        for (const id of drop) seen.delete(id);
      }
    },
    [messageDedupeKey],
  );

  inboxStateRef.current = inboxState;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const unreadCount = useMemo(() => totalUnreadFromState(inboxState), [inboxState]);
  const hasUnreadMessages = unreadCount > 0;

  const bumpRevision = useCallback(() => {
    if (mounted.current) setInboxRevision((n) => n + 1);
  }, []);

  const emitInboxEvent = useCallback(
    (event: InboxRealtimeEvent) => {
      for (const fn of listenersRef.current) {
        try {
          fn(event);
        } catch {
          /* listener */
        }
      }
      bumpRevision();
    },
    [bumpRevision],
  );

  const onInboxEvent = useCallback((listener: InboxListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const setActiveConversationId = useCallback((conversationId: string | null) => {
    activeConversationIdRef.current = conversationId;
  }, []);

  const applyMessageToInbox = useCallback(
    (event: InboxMessageEvent, source: 'realtime' | 'ingest') => {
      if (!uid) return;
      if (isMessageAlreadySeen(event.conversationId, event.createdAt, event.messageId)) {
        return;
      }
      registerMessageSeen(event.conversationId, event.createdAt, event.messageId);

      const next = applyInboxMessage(inboxStateRef.current, uid, event, {
        activeConversationId: activeConversationIdRef.current,
      });
      inboxStateRef.current = next;
      setInboxState(next);
      lastRealtimeMsRef.current = Date.now();

      const enriched: InboxMessageEvent = {
        ...event,
        conversationUnread: next.unreadByConversationId[event.conversationId] ?? 0,
        totalUnread: totalUnreadFromState(next),
      };
      emitInboxEvent(enriched);

      if (
        source === 'realtime' &&
        activeConversationIdRef.current === event.conversationId
      ) {
        void setConversationLastRead(uid, event.conversationId, event.createdAt);
        if (isSupabaseConfigured()) {
          void upsertConversationRead(event.conversationId, event.createdAt);
        }
      }
    },
    [uid, emitInboxEvent, isMessageAlreadySeen, registerMessageSeen],
  );

  const ingestInboxMessage = useCallback(
    (event: InboxMessageEvent) => {
      applyMessageToInbox(event, 'ingest');
    },
    [applyMessageToInbox],
  );

  const markConversationRead = useCallback(
    (conversationId: string, readAtIso?: string) => {
      if (!uid) return;
      const readAt = readAtIso ?? new Date().toISOString();

      const next = applyInboxMarkRead(inboxStateRef.current, conversationId, readAt);
      inboxStateRef.current = next;
      setInboxState(next);
      lastRealtimeMsRef.current = Date.now();
      lastMarkReadMsRef.current = Date.now();
      emitInboxEvent({ type: 'read', conversationId, userId: uid, readAt });

      void setConversationLastRead(uid, conversationId, readAt);
      if (isSupabaseConfigured()) {
        void upsertConversationRead(conversationId, readAt);
      }
    },
    [uid, emitInboxEvent],
  );

  const handleRealtimeEventRef = useRef<(event: InboxRealtimeEvent) => void>(() => {});

  const handleConversationActivity = useCallback(
    async (conversationId: string) => {
      if (!uid) return;
      const snippet = await fetchConversationSnippet(conversationId);
      if (!snippet?.lastMessageAt || !snippet.lastMessageSenderId) return;

      const createdAt = snippet.lastMessageAt;
      const alreadySeen = isMessageAlreadySeen(conversationId, createdAt);

      // Fuente de verdad: conteo del servidor (evita doble +1 con INSERT en messages).
      const next = applyInboxSyncLight(inboxStateRef.current, {
        unreadByConversationId: {
          ...inboxStateRef.current.unreadByConversationId,
          [conversationId]: snippet.unreadCount,
        },
      });
      inboxStateRef.current = next;
      setInboxState(next);
      lastRealtimeMsRef.current = Date.now();

      if (!alreadySeen) {
        registerMessageSeen(conversationId, createdAt);
      }

      emitInboxEvent({
        type: 'message',
        conversationId,
        senderId: snippet.lastMessageSenderId,
        body: snippet.lastMessage ?? '',
        createdAt,
        conversationUnread: snippet.unreadCount,
        totalUnread: totalUnreadFromState(next),
      });
    },
    [uid, emitInboxEvent, isMessageAlreadySeen, registerMessageSeen],
  );

  handleRealtimeEventRef.current = (event: InboxRealtimeEvent) => {
    if (!uid) return;

    if (event.type === 'message') {
      applyMessageToInbox(event, 'realtime');
      return;
    }

    if (event.type === 'conversation_activity') {
      void handleConversationActivity(event.conversationId);
      return;
    }

    if (event.type === 'read' && event.userId === uid) {
      const prevRead = inboxStateRef.current.readAtByConversationId[event.conversationId];
      if (prevRead && new Date(event.readAt).getTime() <= new Date(prevRead).getTime()) {
        return;
      }
      const next = applyInboxMarkRead(inboxStateRef.current, event.conversationId, event.readAt);
      inboxStateRef.current = next;
      setInboxState(next);
      lastRealtimeMsRef.current = Date.now();
      emitInboxEvent(event);
    }
  };

  const syncInboxLight = useCallback(async () => {
    if (!uid || !isMessagingAvailable() || !isSupabaseConfigured() || lightSyncInFlightRef.current) {
      return;
    }
    const sinceMark = Date.now() - lastMarkReadMsRef.current;
    if (sinceMark < MARK_READ_GUARD_MS) return;

    lightSyncInFlightRef.current = true;
    try {
      const payload = await fetchInboxSyncLight();
      if (!mounted.current) return;
      const next = applyInboxSyncLight(inboxStateRef.current, {
        unreadByConversationId: payload.unreadByConversationId,
      });
      inboxStateRef.current = next;
      setInboxState(next);
      bumpRevision();

      for (const s of payload.snippets) {
        if (!s.lastMessageAt || !s.lastMessageSenderId) continue;
        emitInboxEvent({
          type: 'message',
          conversationId: s.conversationId,
          senderId: s.lastMessageSenderId,
          body: s.lastMessage ?? '',
          createdAt: s.lastMessageAt,
          conversationUnread: next.unreadByConversationId[s.conversationId] ?? 0,
          totalUnread: totalUnreadFromState(next),
        });
      }
    } catch {
      /* red lenta */
    } finally {
      lightSyncInFlightRef.current = false;
    }
  }, [uid, bumpRevision, emitInboxEvent]);

  const reconcileInboxFromServer = useCallback(
    async (options?: { force?: boolean }) => {
      if (!uid || !isMessagingAvailable() || reconcileInFlightRef.current) return;
      const sinceRealtime = Date.now() - lastRealtimeMsRef.current;
      const sinceMark = Date.now() - lastMarkReadMsRef.current;
      if (!options?.force && sinceRealtime < RECONCILE_COOLDOWN_MS) return;
      if (!options?.force && sinceMark < MARK_READ_GUARD_MS) return;

      reconcileInFlightRef.current = true;
      try {
        const [conversations, localReads] = await Promise.all([
          loadConversations(uid),
          loadAllReadsForUser(uid),
        ]);
        if (!mounted.current) return;

        let server = hydrateInboxFromConversations(conversations);
        server = mergeLocalReads(server, localReads, uid, conversations);
        const merged = mergeInboxWithServer(inboxStateRef.current, server);
        inboxStateRef.current = merged;
        setInboxState(merged);
        bumpRevision();
      } catch {
        if (mounted.current) setInboxState(emptyInboxState());
      } finally {
        reconcileInFlightRef.current = false;
      }
    },
    [uid, bumpRevision],
  );

  useEffect(() => {
    if (!uid) {
      setInboxState(emptyInboxState());
      inboxStateRef.current = emptyInboxState();
      setInboxRevision(0);
      seenMessageIdsRef.current.clear();
      return;
    }
    seenMessageIdsRef.current.clear();
    void reconcileInboxFromServer({ force: true });
  }, [uid, reconcileInboxFromServer]);

  useEffect(() => {
    if (!uid || !isMessagingAvailable()) return;
    return subscribeInboxRealtime(uid, (event) => handleRealtimeEventRef.current(event));
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const sub = (state: AppStateStatus) => {
      if (state === 'active') void syncInboxLight();
    };
    const ev = AppState.addEventListener('change', sub);
    return () => ev.remove();
  }, [uid, syncInboxLight]);

  const value = useMemo(
    () => ({
      hasUnreadMessages,
      unreadCount,
      unreadByConversationId: inboxState.unreadByConversationId,
      inboxRevision,
      markConversationRead,
      setActiveConversationId,
      ingestInboxMessage,
      onInboxEvent,
      syncInboxLight,
      reconcileInboxFromServer,
    }),
    [
      hasUnreadMessages,
      unreadCount,
      inboxState.unreadByConversationId,
      inboxRevision,
      markConversationRead,
      setActiveConversationId,
      ingestInboxMessage,
      onInboxEvent,
      syncInboxLight,
      reconcileInboxFromServer,
    ],
  );

  return (
    <UnreadMessagesContext.Provider value={value}>{children}</UnreadMessagesContext.Provider>
  );
}

export function useUnreadMessages() {
  const ctx = useContext(UnreadMessagesContext);
  if (!ctx) {
    throw new Error('useUnreadMessages debe usarse dentro de UnreadMessagesProvider');
  }
  return ctx;
}
