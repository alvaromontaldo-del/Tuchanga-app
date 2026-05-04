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
import { computeHasUnreadMessages, computeUnreadCountTotal } from '../services/messaging';
import { useAuth } from './AuthContext';

type UnreadMessagesContextValue = {
  hasUnreadMessages: boolean;
  unreadCount: number;
  refreshUnread: () => Promise<void>;
};

const UnreadMessagesContext = createContext<UnreadMessagesContextValue | null>(null);

const POLL_MS = 18_000;

export function UnreadMessagesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshUnread = useCallback(async () => {
    if (!uid || !isMessagingAvailable()) {
      if (mounted.current) setHasUnreadMessages(false);
      if (mounted.current) setUnreadCount(0);
      return;
    }
    try {
      const [has, total] = await Promise.all([
        computeHasUnreadMessages(uid),
        computeUnreadCountTotal(uid),
      ]);
      if (mounted.current) {
        setHasUnreadMessages(has);
        setUnreadCount(total);
      }
    } catch {
      if (mounted.current) {
        setHasUnreadMessages(false);
        setUnreadCount(0);
      }
    }
  }, [uid]);

  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread]);

  useEffect(() => {
    if (!uid || !isMessagingAvailable()) return;
    const t = setInterval(() => void refreshUnread(), POLL_MS);
    return () => clearInterval(t);
  }, [uid, refreshUnread]);

  useEffect(() => {
    if (!uid) return;
    const sub = (state: AppStateStatus) => {
      if (state === 'active') void refreshUnread();
    };
    const ev = AppState.addEventListener('change', sub);
    return () => ev.remove();
  }, [uid, refreshUnread]);

  const value = useMemo(
    () => ({ hasUnreadMessages, unreadCount, refreshUnread }),
    [hasUnreadMessages, unreadCount, refreshUnread],
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
