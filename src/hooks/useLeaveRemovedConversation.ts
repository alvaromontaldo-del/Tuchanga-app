import { StackActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { isSupabaseConfigured } from '../config/supabase';
import { useUnreadMessages } from '../context/UnreadMessagesContext';
import {
  fetchConversationRemovalSnapshot,
  subscribeConversationRemoval,
} from '../services/chatSupabase';
import {
  CONVERSATION_REMOVED_MESSAGE,
  CONVERSATION_REMOVED_TITLE,
  shouldLeaveDeletedConversation,
} from '../utils/conversationRemovedNotice';

const CHAT_SURFACES = new Set(['ChatConversation', 'DetalleServicio']);

/** Una vez por conversación, aunque el chat y el detalle estén montados juntos. */
const announcedIds = new Set<string>();
const inflight = new Set<string>();
const rerun = new Set<string>();

type LeaveNavigation = {
  getState?: () => {
    routeNames?: string[];
    routes?: Array<{ name?: string }>;
  } | undefined;
  navigate?: (name: string, params?: object) => void;
  dispatch?: (action: ReturnType<typeof StackActions.pop>) => void;
  getParent?: () => { navigate?: (name: string, params?: object) => void } | null | undefined;
};

/** Vuelve a la lista y, si el chat estaba en otro stack, lo saca de encima. */
export function openConversationsList(navigation: LeaveNavigation): void {
  const state = navigation.getState?.();
  const names = state?.routeNames ?? [];
  if (names.includes('ConversationsList') && navigation.navigate) {
    navigation.navigate('ConversationsList');
    return;
  }
  const parent = navigation.getParent?.();
  if (parent?.navigate) {
    parent.navigate('Mensajes', { screen: 'ConversationsList' });
  } else {
    navigation.navigate?.('Mensajes', { screen: 'ConversationsList' });
  }
  const routes = state?.routes ?? [];
  let trailing = 0;
  for (let i = routes.length - 1; i >= 0; i -= 1) {
    if (!CHAT_SURFACES.has(routes[i]?.name ?? '')) break;
    trailing += 1;
  }
  if (trailing > 0 && routes.length - trailing >= 1 && navigation.dispatch) {
    navigation.dispatch(StackActions.pop(trailing));
  }
}

/**
 * Si el hilo que se está viendo pasa a eliminado porque el trabajo terminó,
 * vuelve a Mensajes y avisa una sola vez. No hace nada si sigue visible.
 */
export function useLeaveRemovedConversation(
  conversationId: string | null | undefined,
  options?: { onlyAfterSeenVisible?: boolean },
): {
  recheckRemovedConversation: (reason?: 'action') => void;
  suppressRemovedConversationNotice: () => void;
} {
  const navigation = useNavigation<LeaveNavigation>();
  const { reconcileInboxFromServer } = useUnreadMessages();
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const reconcileRef = useRef(reconcileInboxFromServer);
  reconcileRef.current = reconcileInboxFromServer;
  const recheckRef = useRef<() => void>(() => {});
  const seenVisibleRef = useRef(false);
  const onlyAfterSeenVisible = options?.onlyAfterSeenVisible === true;
  const id = conversationId?.trim() ?? '';
  const seenForId = useRef('');
  const bypassSeenRef = useRef(false);
  if (seenForId.current !== id) {
    seenForId.current = id;
    seenVisibleRef.current = false;
    bypassSeenRef.current = false;
  }

  const suppressRemovedConversationNotice = useCallback(() => {
    if (id) announcedIds.add(id);
  }, [id]);

  const recheckRemovedConversation = useCallback((reason?: 'action') => {
    if (reason === 'action') bypassSeenRef.current = true;
    if (!id || !isSupabaseConfigured()) return;
    if (announcedIds.has(id)) return;
    if (inflight.has(id)) {
      rerun.add(id);
      return;
    }
    inflight.add(id);
    void (async () => {
      try {
        while (!announcedIds.has(id)) {
          rerun.delete(id);
          const snapshot = await fetchConversationRemovalSnapshot(id);
          if (announcedIds.has(id)) return;
          if (snapshot && !snapshot.removed) seenVisibleRef.current = true;
          const leave =
            snapshot != null &&
            (bypassSeenRef.current || !onlyAfterSeenVisible || seenVisibleRef.current) &&
            shouldLeaveDeletedConversation({
              removed: snapshot.removed,
              claimContratacionId: snapshot.claimContratacionId,
              linkedJobs: snapshot.linkedJobs,
              pairJobs: snapshot.pairJobs,
              alreadyAnnounced: announcedIds.has(id),
            });
          if (leave) {
            announcedIds.add(id);
            rerun.delete(id);
            openConversationsList(navigationRef.current);
            Alert.alert(CONVERSATION_REMOVED_TITLE, CONVERSATION_REMOVED_MESSAGE);
            void reconcileRef.current({ force: true });
            return;
          }
          if (!rerun.has(id)) return;
        }
      } catch {
        /* sin red no se adivina el ocultado */
      } finally {
        inflight.delete(id);
        if (rerun.has(id) && !announcedIds.has(id)) {
          rerun.delete(id);
          queueMicrotask(() => recheckRef.current());
        }
      }
    })();
  }, [id, onlyAfterSeenVisible]);
  recheckRef.current = recheckRemovedConversation;

  useEffect(() => {
    if (!id || !isSupabaseConfigured()) return;
    recheckRemovedConversation();
    return subscribeConversationRemoval(id, recheckRemovedConversation);
  }, [id, recheckRemovedConversation]);

  useFocusEffect(
    useCallback(() => {
      recheckRemovedConversation();
      if (!id || !isSupabaseConfigured()) return;
      const timer = setInterval(() => recheckRemovedConversation(), 3000);
      return () => clearInterval(timer);
    }, [id, recheckRemovedConversation]),
  );

  return { recheckRemovedConversation, suppressRemovedConversationNotice };
}
