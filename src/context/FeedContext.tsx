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
import { fetchFeedPostsFromSupabase } from '../services/supabasePosts';

type FeedContextValue = {
  posts: FeedPost[];
  toggleLike: (postId: string) => void;
  addPost: (post: FeedPost) => void;
  removePostLocal: (postId: string) => void;
  refresh: () => Promise<void>;
};

const FeedContext = createContext<FeedContextValue | null>(null);

export function FeedProvider({ children }: { children: ReactNode }) {
  const [posts, setPosts] = useState<FeedPost[]>(
    () => (isSupabaseConfigured() ? [] : INITIAL_FEED_POSTS),
  );

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const rows = await fetchFeedPostsFromSupabase({ limit: 60 });
    setPosts((prev) => {
      // conservar likedByMe/likeCount local si ya existían
      const byId = new Map(prev.map((p) => [p.id, p]));
      return rows.map((r) => {
        const existing = byId.get(r.id);
        return {
          id: r.id,
          workerId: r.workerId,
          workerFirstName: r.workerFirstName,
          workerAvatarUrl: r.workerAvatarUrl,
          workerRatingAverage: r.workerRatingAverage ?? existing?.workerRatingAverage,
          workerReviewCount: r.workerReviewCount ?? existing?.workerReviewCount,
          trade: r.trade,
          workImageUrls: normalizePostImageUrls(r.workImageUrls),
          description: r.description,
          createdAt: r.createdAt,
          likeCount: existing?.likeCount ?? 0,
          likedByMe: existing?.likedByMe ?? false,
        };
      });
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleLike = useCallback((postId: string) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const liked = !p.likedByMe;
        return {
          ...p,
          likedByMe: liked,
          likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)),
        };
      }),
    );
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

  const value = useMemo(
    () => ({ posts, toggleLike, addPost, removePostLocal, refresh }),
    [posts, toggleLike, addPost, removePostLocal, refresh],
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
