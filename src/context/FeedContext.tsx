import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { INITIAL_FEED_POSTS } from '../data/mockFeed';
import type { FeedPost } from '../types/feed';
import { normalizePostImageUrls } from '../types/feed';
import { isSupabaseConfigured } from '../config/supabase';
import { fetchFeedPostsFromSupabase, togglePostLikeInSupabase } from '../services/supabasePosts';

type FeedContextValue = {
  posts: FeedPost[];
  toggleLike: (postId: string) => void;
  addPost: (post: FeedPost) => void;
  removePostLocal: (postId: string) => void;
  refresh: () => Promise<void>;
  /** Actualiza estrellas en todas las publicaciones de un profesional (p. ej. tras una reseña). */
  updateWorkerRatings: (
    workerId: string,
    ratingAverage: number,
    reviewCount: number,
  ) => void;
};

const FeedContext = createContext<FeedContextValue | null>(null);

export function FeedProvider({ children }: { children: ReactNode }) {
  const [posts, setPosts] = useState<FeedPost[]>(
    () => (isSupabaseConfigured() ? [] : INITIAL_FEED_POSTS),
  );

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const rows = await fetchFeedPostsFromSupabase({ limit: 60 });
      setPosts(
        (rows ?? []).map((r) => ({
          id: r.id,
          workerId: r.workerId,
          workerFirstName: r.workerFirstName,
          workerAvatarUrl: r.workerAvatarUrl,
          workerRatingAverage: r.workerRatingAverage,
          workerReviewCount: r.workerReviewCount,
          trade: r.trade,
          workImageUrls: normalizePostImageUrls(r.workImageUrls),
          description: r.description ?? '',
          createdAt: r.createdAt,
          likeCount: r.likeCount,
          likedByMe: r.likedByMe,
        })),
      );
    } catch (e) {
      console.warn('[feed] no se pudo refrescar', e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleLike = useCallback((postId: string) => {
    let snapshot: FeedPost | undefined;
    setPosts((prev) => {
      const current = prev.find((p) => p.id === postId);
      if (!current) return prev;
      snapshot = current;
      const liked = !current.likedByMe;
      return prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              likedByMe: liked,
              likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)),
            }
          : p,
      );
    });

    if (!isSupabaseConfigured()) return;

    void togglePostLikeInSupabase(postId)
      .then(({ liked, likeCount }) => {
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, likedByMe: liked, likeCount } : p)),
        );
      })
      .catch(() => {
        if (!snapshot) return;
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...snapshot as FeedPost } : p)));
      });
  }, []);

  const addPost = useCallback((post: FeedPost) => {
    const next: FeedPost = {
      ...post,
      workImageUrls: normalizePostImageUrls(post.workImageUrls),
    };
    setPosts((prev) => [next, ...prev]);
  }, []);

  const removePostLocal = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const updateWorkerRatings = useCallback(
    (workerId: string, ratingAverage: number, reviewCount: number) => {
      const avg = Math.max(0, Math.min(5, Number(ratingAverage) || 0));
      const count = Math.max(0, Math.floor(Number(reviewCount) || 0));
      setPosts((prev) =>
        prev.map((p) =>
          p.workerId === workerId
            ? { ...p, workerRatingAverage: avg, workerReviewCount: count }
            : p,
        ),
      );
    },
    [],
  );

  const value = useMemo(
    () => ({ posts, toggleLike, addPost, removePostLocal, refresh, updateWorkerRatings }),
    [posts, toggleLike, addPost, removePostLocal, refresh, updateWorkerRatings],
  );

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function useFeed() {
  const ctx = useContext(FeedContext);
  if (!ctx) {
    throw new Error('useFeed debe usarse dentro de FeedProvider');
  }
  return ctx;
}
