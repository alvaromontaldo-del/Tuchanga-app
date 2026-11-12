import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useCommerceShell } from './CommerceShellContext';
import {
  countUnreadAppNotifications,
  listMyAppNotifications,
  markAllAppNotificationsRead,
  markAppNotificationRead,
} from '../services/appNotificationsSupabase';
import {
  audiencesForAppNotifications,
  type AppNotificationRow,
} from '../utils/appNotifications';

type AppNotificationsContextValue = {
  items: AppNotificationRow[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const AppNotificationsContext = createContext<AppNotificationsContextValue | null>(null);

export function AppNotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isCommerceShell } = useCommerceShell();
  const audiences = useMemo(
    () => audiencesForAppNotifications({ isCommerceShell }),
    [isCommerceShell],
  );
  const userId = user?.id ?? null;

  const [items, setItems] = useState<AppNotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    try {
      const [rows, unread] = await Promise.all([
        listMyAppNotifications(audiences),
        countUnreadAppNotifications(audiences),
      ]);
      setItems(rows);
      setUnreadCount(unread);
    } catch {
      /* silencio: la campanita no debe romper inicio ni el tablero */
    } finally {
      setLoading(false);
    }
  }, [audiences, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) return;
    const sb = getSupabaseClient();
    const channel = sb
      .channel(`app_notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [refresh, userId]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((prev) =>
        prev.map((row) =>
          row.id === id && !row.readAt ? { ...row, readAt: new Date().toISOString() } : row,
        ),
      );
      setUnreadCount((n) => (n > 0 ? n - 1 : 0));
      try {
        await markAppNotificationRead(id);
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) =>
      prev.map((row) => (row.readAt ? row : { ...row, readAt: new Date().toISOString() })),
    );
    setUnreadCount(0);
    try {
      await markAllAppNotificationsRead(audiences);
    } catch {
      void refresh();
    }
  }, [audiences, refresh]);

  const value = useMemo(
    () => ({ items, unreadCount, loading, refresh, markRead, markAllRead }),
    [items, unreadCount, loading, refresh, markRead, markAllRead],
  );

  return (
    <AppNotificationsContext.Provider value={value}>{children}</AppNotificationsContext.Provider>
  );
}

export function useAppNotifications() {
  const ctx = useContext(AppNotificationsContext);
  if (!ctx) {
    throw new Error('useAppNotifications debe usarse dentro de AppNotificationsProvider');
  }
  return ctx;
}
