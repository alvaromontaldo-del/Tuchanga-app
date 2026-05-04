import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChangaPostListRow } from '../../components/feed/ChangaPostListRow';
import { useAppToast } from '../../components/toast/toast';
import { colors, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { INITIAL_FEED_POSTS } from '../../data/mockFeed';
import { isWorkerUserIdUuid } from '../../data/workerChatIds';
import { useAuth } from '../../context/AuthContext';
import { useFeed } from '../../context/FeedContext';
import type {
  FeedStackScreenProps,
  SearchStackScreenProps,
} from '../../navigation/mainTypes';
import {
  deletePostInSupabase,
  fetchPostsByWorkerIdFromSupabase,
  hidePostInSupabase,
} from '../../services/supabasePosts';
import type { FeedPost } from '../../types/feed';

type Props = FeedStackScreenProps<'WorkerPosts'> | SearchStackScreenProps<'WorkerPosts'>;

function mergeWithFeedLikes(remote: FeedPost[], feed: FeedPost[]): FeedPost[] {
  const feedById = new Map(feed.map((p) => [p.id, p]));
  return remote.map((p) => {
    const hit = feedById.get(p.id);
    if (hit) return hit;
    return { ...p, likeCount: p.likeCount ?? 0, likedByMe: p.likedByMe ?? false };
  });
}

export function WorkerPostsScreen({ route, navigation }: Props) {
  const { workerId: rawWorkerId } = route.params;
  const { user } = useAuth();
  const toast = useAppToast();
  const { posts: feedPosts, removePostLocal } = useFeed();

  const resolvedWorkerId = useMemo(() => {
    if (rawWorkerId === 'me' && user?.id) return user.id;
    return rawWorkerId;
  }, [rawWorkerId, user?.id]);

  const useRemote = isSupabaseConfigured() && isWorkerUserIdUuid(resolvedWorkerId);

  const localMerged = useMemo(() => {
    const fromFeed = feedPosts.filter((p) => p.workerId === resolvedWorkerId);
    const fromMock = INITIAL_FEED_POSTS.filter((p) => p.workerId === resolvedWorkerId);
    const byId = new Map<string, FeedPost>();
    [...fromMock, ...fromFeed].forEach((p) => byId.set(p.id, p));
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [feedPosts, resolvedWorkerId]);

  const [fetchedPosts, setFetchedPosts] = useState<FeedPost[] | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(useRemote);

  useEffect(() => {
    if (!useRemote) {
      setFetchedPosts(null);
      setLoadingRemote(false);
      return;
    }
    let cancelled = false;
    setLoadingRemote(true);
    void fetchPostsByWorkerIdFromSupabase(resolvedWorkerId)
      .then((rows) => {
        if (cancelled) return;
        const base: FeedPost[] = rows.map((r) => ({
          ...r,
          likeCount: 0,
          likedByMe: false,
        }));
        setFetchedPosts(base);
      })
      .catch(() => {
        if (!cancelled) setFetchedPosts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRemote(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedWorkerId, useRemote]);

  const displayPosts = useRemote ? fetchedPosts : localMerged;
  const finalPosts = useMemo(() => {
    if (displayPosts == null) return [];
    return mergeWithFeedLikes(displayPosts, feedPosts);
  }, [displayPosts, feedPosts]);

  function openPostDetail(postId: string) {
    const tab = navigation.getParent();
    if (tab) {
      tab.navigate('Inicio', { screen: 'PostDetail', params: { postId } });
    }
  }

  if (useRemote && loadingRemote) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {finalPosts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Sin publicaciones todavía</Text>
            <Text style={styles.emptyText}>
              Cuando este profesional comparta trabajos, van a aparecer acá.
            </Text>
          </View>
        ) : (
          finalPosts.map((post) => {
            const isOwner = user?.id === post.workerId;
            const canHide = Boolean(user && user.id !== post.workerId);

            return (
              <ChangaPostListRow
                key={post.id}
                post={post}
                onPress={() => openPostDetail(post.id)}
                onPressMenu={
                  isOwner
                    ? () => {
                        Alert.alert(
                          'Eliminar publicación',
                          '¿Estás seguro de que deseas eliminar esta publicación permanentemente?',
                          [
                            { text: 'Cancelar', style: 'cancel' },
                            {
                              text: 'Eliminar',
                              style: 'destructive',
                              onPress: () => {
                                void (async () => {
                                  try {
                                    if (isSupabaseConfigured()) {
                                      await deletePostInSupabase(post.id);
                                    }
                                    removePostLocal(post.id);
                                    setFetchedPosts((prev) =>
                                      prev ? prev.filter((p) => p.id !== post.id) : prev,
                                    );
                                    toast.success('Publicación eliminada.', 'Listo');
                                  } catch (e) {
                                    toast.error(
                                      e instanceof Error ? e.message : 'No se pudo eliminar.',
                                      'Error',
                                      { durationMs: 4200 },
                                    );
                                  }
                                })();
                              },
                            },
                          ],
                        );
                      }
                    : canHide
                      ? () => {
                          Alert.alert('Ocultar publicación', 'No la vas a ver más en tu inicio.', [
                            { text: 'Cancelar', style: 'cancel' },
                            {
                              text: 'Ocultar',
                              onPress: () => {
                                void (async () => {
                                  try {
                                    if (!user?.id) throw new Error('Necesitás iniciar sesión.');
                                    if (isSupabaseConfigured()) {
                                      await hidePostInSupabase(post.id);
                                    }
                                    removePostLocal(post.id);
                                    setFetchedPosts((prev) =>
                                      prev ? prev.filter((p) => p.id !== post.id) : prev,
                                    );
                                    toast.success(
                                      'Listo. No la vas a ver más en tu inicio.',
                                      'Ocultada',
                                    );
                                  } catch (e) {
                                    toast.error(
                                      e instanceof Error ? e.message : 'No se pudo ocultar.',
                                      'Error',
                                      { durationMs: 4200 },
                                    );
                                  }
                                })();
                              },
                            },
                          ]);
                        }
                      : undefined
                }
              />
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
