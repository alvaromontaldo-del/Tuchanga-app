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
import { isSupabaseConfigured } from '../config/supabase';
import { useAppToast } from '../components/toast/toast';
import { useAuth } from './AuthContext';
import type { FavoriteProfessional } from '../services/favoritesSupabase';
import { fetchFavoritesFromSupabase, toggleFavoriteInSupabase } from '../services/favoritesSupabase';

type FavoritesContextValue = {
  /** IDs favoritos (para “corazón” rápido). */
  favoriteIds: Set<string>;
  /** Lista detallada (para FavoritesScreen). */
  favorites: FavoriteProfessional[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  /** Optimistic toggle: devuelve el estado final optimista inmediatamente. */
  toggleFavorite: (params: {
    professional: FavoriteProfessional;
  }) => Promise<{ isFavorite: boolean }>;
  toggleFavoriteById: (params: {
    professionalId: string;
    optimisticData?: FavoriteProfessional;
  }) => Promise<{ isFavorite: boolean }>;
  isFavorite: (professionalId: string) => boolean;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function upsertFavorite(list: FavoriteProfessional[], item: FavoriteProfessional) {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [item, ...list];
  const next = list.slice();
  next[idx] = item;
  return next;
}

function removeFavorite(list: FavoriteProfessional[], id: string) {
  return list.filter((x) => x.id !== id);
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  const toast = useAppToast();
  const [favorites, setFavorites] = useState<FavoriteProfessional[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [isLoading, setLoading] = useState(false);
  const refreshSeq = useRef(0);

  const applyFromList = useCallback((list: FavoriteProfessional[]) => {
    setFavorites(list);
    setFavoriteIds(new Set(list.map((x) => x.id)));
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthed || !isSupabaseConfigured()) {
      applyFromList([]);
      return;
    }
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const list = await fetchFavoritesFromSupabase();
      if (refreshSeq.current === seq) applyFromList(list);
    } catch (e) {
      if (refreshSeq.current !== seq) return;
      toast.error(
        e instanceof Error ? e.message : 'No se pudieron cargar tus favoritos',
        'Favoritos',
        { durationMs: 4200 },
      );
    } finally {
      if (refreshSeq.current === seq) setLoading(false);
    }
  }, [applyFromList, isAuthed, toast]);

  useEffect(() => {
    // Al loguear/desloguear, sincronizamos.
    void refresh();
  }, [refresh]);

  const isFavorite = useCallback(
    (professionalId: string) => favoriteIds.has(professionalId),
    [favoriteIds],
  );

  const toggleFavoriteById = useCallback(
    async (params: {
      professionalId: string;
      optimisticData?: FavoriteProfessional;
    }) => {
      if (!isAuthed) throw new Error('Necesitás iniciar sesión para usar favoritos.');
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase no está configurado. No se pueden usar favoritos.');
      }

      const id = params.professionalId;
      const wasFav = favoriteIds.has(id);
      const optimisticIsFav = !wasFav;

      // Optimistic UI
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (optimisticIsFav) next.add(id);
        else next.delete(id);
        return next;
      });
      setFavorites((prev) => {
        if (optimisticIsFav) {
          if (params.optimisticData) return upsertFavorite(prev, params.optimisticData);
          return prev;
        }
        return removeFavorite(prev, id);
      });

      try {
        const res = await toggleFavoriteInSupabase({ professionalId: id });
        // Si el servidor no coincide (raro, pero puede pasar), corregimos.
        if (res.isFavorite !== optimisticIsFav) {
          setFavoriteIds((prev) => {
            const next = new Set(prev);
            if (res.isFavorite) next.add(id);
            else next.delete(id);
            return next;
          });
          setFavorites((prev) => {
            if (res.isFavorite) {
              if (params.optimisticData) return upsertFavorite(prev, params.optimisticData);
              return prev;
            }
            return removeFavorite(prev, id);
          });
        }
        return res;
      } catch (e) {
        // Revert optimistic
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          if (wasFav) next.add(id);
          else next.delete(id);
          return next;
        });
        setFavorites((prev) => {
          if (wasFav) {
            if (params.optimisticData) return upsertFavorite(prev, params.optimisticData);
            return prev;
          }
          return removeFavorite(prev, id);
        });
        throw e;
      }
    },
    [favoriteIds, isAuthed],
  );

  const toggleFavorite = useCallback(
    async (params: { professional: FavoriteProfessional }) =>
      toggleFavoriteById({
        professionalId: params.professional.id,
        optimisticData: params.professional,
      }),
    [toggleFavoriteById],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      favoriteIds,
      isLoading,
      refresh,
      toggleFavorite,
      toggleFavoriteById,
      isFavorite,
    }),
    [favorites, favoriteIds, isLoading, refresh, toggleFavorite, toggleFavoriteById, isFavorite],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites debe usarse dentro de FavoritesProvider');
  return ctx;
}

