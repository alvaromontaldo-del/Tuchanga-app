import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../config/supabase';
import type { AuthUser } from '../services/auth';
import { fetchCurrentUserProfileFromSupabase } from '../services/supabaseUser';
import { mergeAuthUserProfile } from '../utils/mergeAuthUserProfile';

export type UseCurrentUserProfileResult = {
  /** Datos listos para la UI: lo último traído de BD o el usuario en contexto. */
  displayUser: AuthUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isAuthed: boolean;
  isRestoring: boolean;
};

/**
 * Carga el perfil del usuario autenticado desde Supabase (o reutiliza el contexto si no hay backend).
 */
export function useCurrentUserProfile(): UseCurrentUserProfileResult {
  const { user, isAuthed, isRestoring, replaceOrMergeUser } = useAuth();
  const [fetched, setFetched] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthed || !user?.id) {
      setFetched(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!isSupabaseConfigured()) {
      setFetched(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await fetchCurrentUserProfileFromSupabase();
      if (next) {
        setFetched(next);
        replaceOrMergeUser(next);
      } else {
        setFetched(null);
        setError('No se pudo obtener el usuario. Iniciá sesión de nuevo.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el perfil.');
      setFetched(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthed, user?.id, replaceOrMergeUser]);

  useEffect(() => {
    if (isRestoring) return;
    void refresh();
  }, [isRestoring, refresh]);

  const displayUser = isAuthed ? mergeAuthUserProfile(user, fetched) : null;

  const busy =
    isRestoring ||
    (isAuthed && isSupabaseConfigured() && loading && fetched === null);

  return {
    displayUser,
    loading: busy,
    error,
    refresh,
    isAuthed,
    isRestoring,
  };
}
