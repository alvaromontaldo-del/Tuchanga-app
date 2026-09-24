import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { isSupabaseConfigured } from '../config/supabase';
import { fetchMyStores } from '../services/storeQuotesSupabase';
import type { MyStoreSummary } from '../types/materials';

const COMMERCE_INTENT_KEY = '@yachanga/commerce_intent';
const SESSION_ROLE_KEY = '@yachanga/session_role';

export type SessionRole = 'client' | 'commerce';

/** Statuses that allow choosing the commerce shell. */
/** Estados que habilitan el shell comercio (NO incluye pending_approval). */
export const COMMERCE_SHELL_STATUSES = new Set([
  'trial',
  'active',
  'unpaid',
  'paused',
]);

/** Comercio creado pero aun no aceptado por admin. */
export const COMMERCE_PENDING_STATUS = 'pending_approval';


type CommerceShellContextValue = {
  stores: MyStoreSummary[];
  loading: boolean;
  /** Active session is commerce-only UI. */
  isCommerceShell: boolean;
  commerceIntent: boolean;
  sessionRole: SessionRole | null;
  /** User has store(s) and must pick client vs commerce (provisional testing). */
  needsRoleChoice: boolean;
  primaryStore: MyStoreSummary | null;
  hasCommerceStore: boolean;
  /** True si hay local en pending_approval (aun no aprobado). */
  hasPendingCommerceStore: boolean;
  refresh: () => Promise<MyStoreSummary[]>;
  enterCommerceIntent: () => Promise<void>;
  clearCommerceIntent: () => Promise<void>;
  chooseSessionRole: (role: SessionRole) => Promise<void>;
  clearSessionRole: () => Promise<void>;
};

const CommerceShellContext = createContext<CommerceShellContextValue | null>(null);

export function CommerceShellProvider({ children }: { children: ReactNode }) {
  const { user, isAuthed } = useAuth();
  const [stores, setStores] = useState<MyStoreSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [commerceIntent, setCommerceIntent] = useState(false);
  const [sessionRole, setSessionRole] = useState<SessionRole | null>(null);
  const [roleHydrated, setRoleHydrated] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [intentRaw, roleRaw] = await Promise.all([
          AsyncStorage.getItem(COMMERCE_INTENT_KEY),
          AsyncStorage.getItem(SESSION_ROLE_KEY),
        ]);
        if (cancelled) return;
        setCommerceIntent(intentRaw === '1');
        if (roleRaw === 'client' || roleRaw === 'commerce') {
          setSessionRole(roleRaw);
        }
      } catch {
        if (!cancelled) {
          setCommerceIntent(false);
          setSessionRole(null);
        }
      } finally {
        if (!cancelled) setRoleHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setToken((n) => n + 1);
    if (!isAuthed || !user?.id || !isSupabaseConfigured()) {
      setStores([]);
      return [] as MyStoreSummary[];
    }
    setLoading(true);
    try {
      const list = await fetchMyStores();
      setStores(list);
      return list;
    } catch {
      setStores([]);
      return [] as MyStoreSummary[];
    } finally {
      setLoading(false);
    }
  }, [isAuthed, user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!isAuthed || !user?.id || !isSupabaseConfigured()) {
        setStores([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const list = await fetchMyStores();
        if (!cancelled) setStores(list);
      } catch {
        if (!cancelled) setStores([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [isAuthed, user?.id, token]);

  // Al cerrar sesión, no forzar rol persistido en UI guest (se mantiene en storage para próximo login).
  useEffect(() => {
    if (!isAuthed) {
      // sessionRole stays in memory from storage hydrate; MainScreen won't use shell without auth
    }
  }, [isAuthed]);

  const enterCommerceIntent = useCallback(async () => {
    setCommerceIntent(true);
    try {
      await AsyncStorage.setItem(COMMERCE_INTENT_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const clearCommerceIntent = useCallback(async () => {
    setCommerceIntent(false);
    try {
      await AsyncStorage.removeItem(COMMERCE_INTENT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const chooseSessionRole = useCallback(async (role: SessionRole) => {
    if (role === 'commerce') {
      const approved = stores.some((st) => COMMERCE_SHELL_STATUSES.has(st.status));
      const pendingOnly = !approved && stores.some((st) => st.status === COMMERCE_PENDING_STATUS);
      if (pendingOnly) {
        // El caller debe mostrar el Alert; acá no elevamos a shell comercio.
        return;
      }
    }

    setSessionRole(role);
    try {
      await AsyncStorage.setItem(SESSION_ROLE_KEY, role);
      if (role === 'commerce') {
        await AsyncStorage.setItem(COMMERCE_INTENT_KEY, '1');
        setCommerceIntent(true);
      } else {
        await AsyncStorage.removeItem(COMMERCE_INTENT_KEY);
        setCommerceIntent(false);
      }
    } catch {
      /* ignore */
    }
  }, [stores]);

  const clearSessionRole = useCallback(async () => {
    setSessionRole(null);
    try {
      await AsyncStorage.removeItem(SESSION_ROLE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const hasCommerceStore = stores.some((s) => COMMERCE_SHELL_STATUSES.has(s.status));
  const hasPendingCommerceStore = stores.some((s) => s.status === COMMERCE_PENDING_STATUS);

  /**
   * Provisional: si tiene comercio y aún no eligió rol en esta sesión hidratada,
   * pedir elección (mismo email cliente + comercio).
   */
  const needsRoleChoice = Boolean(
    isAuthed &&
      roleHydrated &&
      !loading &&
      hasCommerceStore &&
      sessionRole == null,
  );

  const isCommerceShell = Boolean(
    isAuthed &&
      roleHydrated &&
      (sessionRole === 'commerce' ||
        (sessionRole == null && commerceIntent && !hasCommerceStore && !hasPendingCommerceStore)),
  );

  const primaryStore = useMemo(() => {
    const preferred = stores.find((s) => s.status === 'active' || s.status === 'trial');
    return preferred ?? stores[0] ?? null;
  }, [stores]);

  const value = useMemo(
    () => ({
      stores,
      loading: loading || !roleHydrated,
      isCommerceShell,
      commerceIntent,
      sessionRole,
      needsRoleChoice,
      primaryStore,
      hasCommerceStore,
      hasPendingCommerceStore,
      refresh,
      enterCommerceIntent,
      clearCommerceIntent,
      chooseSessionRole,
      clearSessionRole,
    }),
    [
      stores,
      loading,
      roleHydrated,
      isCommerceShell,
      commerceIntent,
      sessionRole,
      needsRoleChoice,
      primaryStore,
      hasCommerceStore,
      hasPendingCommerceStore,
      refresh,
      enterCommerceIntent,
      clearCommerceIntent,
      chooseSessionRole,
      clearSessionRole,
    ],
  );

  return (
    <CommerceShellContext.Provider value={value}>{children}</CommerceShellContext.Provider>
  );
}

export function useCommerceShell(): CommerceShellContextValue {
  const ctx = useContext(CommerceShellContext);
  if (!ctx) {
    throw new Error('useCommerceShell debe usarse dentro de CommerceShellProvider');
  }
  return ctx;
}
