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
import { AppState } from 'react-native';
import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import type { AuthUser } from '../services/auth';
import { tryApplyPendingProfileSignup } from '../services/pendingProfileSignup';
import { fetchAuthUserFromSupabase } from '../services/supabaseUser';
import { clearSession, loadStoredSession, persistSession } from '../services/authSession';
import { mergeAuthUserProfile } from '../utils/mergeAuthUserProfile';
import { stableUserIdFromEmail } from '../utils/stableUserId';
import {
  clearExpoPushTokenFromSupabase,
  persistExpoPushTokenToSupabase,
  registerAndGetExpoPushToken,
} from '../services/pushNotifications';
import {
  isDeletedOrInvalidAuthError,
  validateAccountForAction,
  validateRemoteAccount,
} from '../services/sessionValidity';
import { isPaymentSessionGuarded } from '../services/paymentSessionGuard';

type AuthContextValue = {
  isAuthed: boolean;
  isRestoring: boolean;
  user: AuthUser | null;
  flashMessage: string | null;
  setFlashMessage: (message: string | null) => void;
  signIn: (user: AuthUser, keepSignedIn: boolean) => Promise<void>;
  /** Combina con el usuario en memoria (evita perder perfil si un fetch devuelve solo id/email). */
  replaceOrMergeUser: (next: AuthUser) => void;
  signOut: () => Promise<void>;
  /**
   * Verifica Auth+perfil. Si la cuenta ya no existe: cierra sesiÃ³n,
   * avisa y abre Registro. Devuelve false si no hay sesiÃ³n vÃ¡lida.
   */
  ensureActiveAccount: (options?: { redirectTo?: string }) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isRestoring, setRestoring] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const forcingOutRef = useRef(false);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  const syncPushToken = useCallback(async () => {
    try {
      const res = await registerAndGetExpoPushToken();
      if (res.ok) {
        await persistExpoPushTokenToSupabase(res.token);
      }
    } catch {
      /* un fallo de push no debe tumbar la sesiÃ³n */
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    if (isRestoring) return;
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      await syncPushToken();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [isRestoring, syncPushToken, user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    if (!user?.id) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncPushToken();
    });
    return () => sub.remove();
  }, [syncPushToken, user?.id]);

  const signIn = useCallback(async (nextUser: AuthUser, keepSignedIn: boolean) => {
    if (!isSupabaseConfigured()) {
      await persistSession({ user: nextUser }, keepSignedIn);
    }
    setUser((prev) => mergeAuthUserProfile(prev, nextUser));
  }, []);

  const replaceOrMergeUser = useCallback((next: AuthUser) => {
    setUser((prev) => mergeAuthUserProfile(prev, next));
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) {
      try {
        await clearExpoPushTokenFromSupabase();
      } catch {
        /* ignore */
      }
      try {
        await getSupabaseClient().auth.signOut({ scope: 'local' });
      } catch {
        try {
          await getSupabaseClient().auth.signOut();
        } catch {
          /* ignore */
        }
      }
    }
    await clearSession();
    setUser(null);
  }, []);

  const forceAccountUnavailable = useCallback(
    async (options?: { redirectTo?: string }) => {
      if (forcingOutRef.current) return;
      if (isPaymentSessionGuarded()) return;
      forcingOutRef.current = true;
      try {
        await signOut();
        setFlashMessage('Tu cuenta ya no estÃ¡ disponible o ha sido desactivada.');
        try {
          const { openAuthModal } = await import('../navigation/openAuthModal');
          // Como alguien sin registrarse: ir a Registro (no Login).
          openAuthModal('Register', options?.redirectTo ? { redirectTo: options.redirectTo } : undefined);
        } catch {
          /* ignore */
        }
      } finally {
        // Permitir otro force mÃ¡s adelante en la misma sesiÃ³n de app.
        setTimeout(() => {
          forcingOutRef.current = false;
        }, 1500);
      }
    },
    [signOut],
  );

  const ensureActiveAccount = useCallback(
    async (options?: { redirectTo?: string }): Promise<boolean> => {
      if (!isSupabaseConfigured()) {
        return Boolean(user?.id);
      }
      try {
        const sb = getSupabaseClient();
        const {
          data: { session },
        } = await sb.auth.getSession();
        const uid = session?.user?.id ?? user?.id;
        if (!uid) {
          // Sin sesiÃ³n ni user en memoria: tratar como invitado (abrir registro).
          await forceAccountUnavailable(options);
          return false;
        }
        const ok = await validateAccountForAction(uid);
        if (!ok) {
          await forceAccountUnavailable(options);
          return false;
        }
        return true;
      } catch (e) {
        if (isDeletedOrInvalidAuthError(e)) {
          await forceAccountUnavailable(options);
          return false;
        }
        // Red / transitorio: no expulsamos.
        return Boolean(user?.id);
      }
    },
    [forceAccountUnavailable, user?.id],
  );

  useEffect(() => {
    let mounted = true;

    if (isSupabaseConfigured()) {
      let sb: ReturnType<typeof getSupabaseClient>;
      try {
        sb = getSupabaseClient();
      } catch {
        if (mounted) setRestoring(false);
        return () => {
          mounted = false;
        };
      }

      const AUTH_RESTORE_MS = 15_000;

      void (async () => {
        try {
          const restore = async () => {
            const {
              data: { session },
            } = await sb.auth.getSession();
            if (!mounted) return;
            if (session?.user) {
              const ok = await validateRemoteAccount(session.user.id);
              if (!ok) {
                if (mounted) await forceAccountUnavailable();
                return;
              }
              const minimal: AuthUser = {
                id: session.user.id,
                email: session.user.email ?? '',
              };
              try {
                await tryApplyPendingProfileSignup(session.user.id);
                const u = await fetchAuthUserFromSupabase(session.user);
                if (mounted) setUser((prev) => mergeAuthUserProfile(prev, u));
              } catch {
                if (mounted) setUser((prev) => mergeAuthUserProfile(prev, minimal));
              }
            }
          };

          await Promise.race([
            restore(),
            new Promise<void>((_, reject) => {
              setTimeout(() => reject(new Error('auth_restore_timeout')), AUTH_RESTORE_MS);
            }),
          ]);
        } catch {
          /* timeout / red */
        } finally {
          if (mounted) setRestoring(false);
        }
      })();

      let subscription: { unsubscribe: () => void } | undefined;
      try {
        const { data } = sb.auth.onAuthStateChange((event, session) => {
          setTimeout(() => {
            void (async () => {
              if (!mounted) return;
              if (session?.user) {
                // Solo en sign-in inicial validamos borrado. En TOKEN_REFRESHED
                // no hay que revalidar agresivo (en iOS dispara falsos positivos).
                if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                  const ok = await validateRemoteAccount(session.user.id);
                  if (!ok) {
                    await forceAccountUnavailable();
                    return;
                  }
                }
                const minimal: AuthUser = {
                  id: session.user.id,
                  email: session.user.email ?? '',
                };
                try {
                  await tryApplyPendingProfileSignup(session.user.id);
                  const u = await fetchAuthUserFromSupabase(session.user);
                  if (mounted) setUser((prev) => mergeAuthUserProfile(prev, u));
                } catch {
                  if (mounted) setUser((prev) => mergeAuthUserProfile(prev, minimal));
                }
              } else if (mounted && event === 'SIGNED_OUT') {
                setUser(null);
              }
            })();
          }, 0);
        });
        subscription = data.subscription;
      } catch {
        if (mounted) setRestoring(false);
        return () => {
          mounted = false;
        };
      }

      // Al volver al foreground: solo outs definitivos (usuario borrado en Auth).
      // Nunca expulsar solo porque getSession() venga vacÃ­o un instante (comÃºn en iOS al refrescar token).
      const appSub = AppState.addEventListener('change', (state) => {
        if (state !== 'active') return;
        void (async () => {
          try {
            if (isPaymentSessionGuarded()) return;
            const uid = userRef.current?.id;
            if (!uid) return;
            const {
              data: { session },
            } = await sb.auth.getSession();
            if (!session?.user) return;
            const ok = await validateRemoteAccount(session.user.id);
            if (!ok && mounted) await forceAccountUnavailable();
          } catch {
            /* ignore */
          }
        })();
      });

      return () => {
        mounted = false;
        try {
          subscription?.unsubscribe();
        } catch {
          /* ignore */
        }
        appSub.remove();
      };
    }

    void (async () => {
      try {
        const stored = await loadStoredSession();
        if (mounted && stored?.user) {
          let u = stored.user;
          if (!u.id && u.email) {
            u = { ...u, id: stableUserIdFromEmail(u.email) };
            await persistSession({ ...stored, user: u }, true);
          }
          setUser(u);
        }
      } finally {
        if (mounted) setRestoring(false);
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user se lee en revalidate vÃ­a closure fresca en interval; forceAccountUnavailable es estable
  }, [forceAccountUnavailable]);

  const value = useMemo(
    () => ({
      isAuthed: Boolean(user),
      isRestoring,
      user,
      flashMessage,
      setFlashMessage,
      signIn,
      replaceOrMergeUser,
      signOut,
      ensureActiveAccount,
    }),
    [isRestoring, user, flashMessage, signIn, replaceOrMergeUser, signOut, ensureActiveAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
}

