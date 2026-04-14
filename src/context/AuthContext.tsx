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
import type { AuthUser } from '../services/auth';
import { tryApplyPendingProfileSignup } from '../services/pendingProfileSignup';
import { fetchAuthUserFromSupabase } from '../services/supabaseUser';
import { clearSession, loadStoredSession, persistSession } from '../services/authSession';
import { mergeAuthUserProfile } from '../utils/mergeAuthUserProfile';
import { stableUserIdFromEmail } from '../utils/stableUserId';

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
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isRestoring, setRestoring] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

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
          // Red lenta, URL incorrecta o timeout: la app debe arrancar igual (sesión se reintenta con onAuthStateChange).
        } finally {
          if (mounted) setRestoring(false);
        }
      })();

      let subscription: { unsubscribe: () => void } | undefined;
      try {
        // En web (y a veces nativo), await dentro del callback puede bloquear el lock interno de
        // GoTrue y dejar signInWithPassword colgado. Diferimos el trabajo async (doc Supabase).
        const { data } = sb.auth.onAuthStateChange((event, session) => {
          setTimeout(() => {
            void (async () => {
              if (!mounted) return;
              if (session?.user) {
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
                // No limpiar en otros eventos con session null (p. ej. transiciones de GoTrue),
                // para no mandar al tab Perfil a la vista de invitado por error.
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

      return () => {
        mounted = false;
        try {
          subscription?.unsubscribe();
        } catch {
          /* ignore */
        }
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
  }, []);

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
        await getSupabaseClient().auth.signOut();
      } catch {
        /* ignore */
      }
    }
    await clearSession();
    setUser(null);
  }, []);

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
    }),
    [isRestoring, user, flashMessage, signIn, replaceOrMergeUser, signOut],
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
