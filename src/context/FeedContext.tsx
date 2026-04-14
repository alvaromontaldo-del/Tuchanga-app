import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { INITIAL_FEED_POSTS } from '../data/mockFeed';
import type { FeedPost } from '../types/feed';
import { normalizePostImageUrls } from '../types/feed';

type FeedContextValue = {
  posts: FeedPost[];
  toggleLike: (postId: string) => void;
  addPost: (post: FeedPost) => void;
};

const FeedContext = createContext<FeedContextValue | null>(null);

export function FeedProvider({ children }: { children: ReactNode }) {
  const [posts, setPosts] = useState<FeedPost[]>(INITIAL_FEED_POSTS);

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

  const value = useMemo(
    () => ({ posts, toggleLike, addPost }),
    [posts, toggleLike, addPost],
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
