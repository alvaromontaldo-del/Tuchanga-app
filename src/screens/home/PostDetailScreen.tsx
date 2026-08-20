import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChangaImagePost } from '../../components/feed/ChangaImagePost';
import { useAppToast } from '../../components/toast/toast';
import { colors, spacing } from '../../constants/theme';
import { isMessagingAvailable } from '../../config/api';
import { isSupabaseConfigured } from '../../config/supabase';
import { useAuth } from '../../context/AuthContext';
import { useFeed } from '../../context/FeedContext';
import type { FeedStackScreenProps } from '../../navigation/mainTypes';
import { openAuthModal } from '../../navigation/openAuthModal';
import { openOrCreateChat } from '../../services/messaging';
import {
  deletePostInSupabase,
  fetchPostByIdFromSupabase,
  hidePostInSupabase,
} from '../../services/supabasePosts';
import type { FeedPost } from '../../types/feed';

type Props = FeedStackScreenProps<'PostDetail'>;

export function PostDetailScreen({ route, navigation }: Props) {
  const { postId } = route.params;
  const { posts, toggleLike, removePostLocal } = useFeed();
  const { user, ensureActiveAccount } = useAuth();
  const toast = useAppToast();
  const [busy, setBusy] = useState<'none' | 'delete' | 'hide'>('none');
  const [remotePost, setRemotePost] = useState<FeedPost | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const feedPost = useMemo(() => posts.find((p) => p.id === postId) ?? null, [posts, postId]);
  const post = feedPost ?? remotePost;

  useEffect(() => {
    if (feedPost) {
      setUnavailable(false);
      setRemotePost(null);
      return;
    }
    if (!isSupabaseConfigured()) {
      setUnavailable(true);
      return;
    }
    let cancelled = false;
    setLoadingRemote(true);
    void (async () => {
      try {
        const fetched = await fetchPostByIdFromSupabase(postId);
        if (cancelled) return;
        if (!fetched) {
          setUnavailable(true);
          setRemotePost(null);
        } else {
          setUnavailable(false);
          setRemotePost(fetched as FeedPost);
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        if (!cancelled) setLoadingRemote(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feedPost, postId]);

  if (loadingRemote && !post) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!post || unavailable) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <Text style={styles.muted}>Esta publicación ya no está disponible.</Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          >
            <Text style={styles.backBtnText}>Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const p = post;
  const isOwner = Boolean(user?.id && p.workerId && user.id === p.workerId);

  async function confirmDelete() {
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
              if (busy !== 'none') return;
              setBusy('delete');
              try {
                if (isSupabaseConfigured()) {
                  await deletePostInSupabase(p.id);
                }
                removePostLocal(p.id);
                navigation.goBack();
                toast.success('Publicación eliminada.', 'Listo');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'No se pudo eliminar.', 'Error', {
                  durationMs: 4200,
                });
              } finally {
                setBusy('none');
              }
            })();
          },
        },
      ],
    );
  }

  async function hideForMe() {
    if (busy !== 'none') return;
    setBusy('hide');
    try {
      if (!user?.id) throw new Error('Necesitás iniciar sesión.');
      if (isSupabaseConfigured()) {
        await hidePostInSupabase(p.id);
      }
      removePostLocal(p.id);
      navigation.goBack();
      toast.success('Listo. No la vas a ver más en tu inicio.', 'Ocultada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo ocultar.', 'Error', {
        durationMs: 4200,
      });
    } finally {
      setBusy('none');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ChangaImagePost
        post={p}
        onToggleLike={() => toggleLike(p.id)}
        onOpenProfile={() => navigation.navigate('WorkerProfile', { workerId: p.workerId })}
        showMessageButton={Boolean(user && user.id !== p.workerId)}
        onOpenMessage={async () => {
          if (!user) {
            openAuthModal('Register', { redirectTo: `worker:${p.workerId}` });
            return;
          }
          if (user.id === p.workerId) return;
          if (!isMessagingAvailable()) {
            toast.warning(
              'Agregá Supabase o el servidor de mensajería (EXPO_PUBLIC_API_URL) para chatear.',
              'Configurar chat',
              { durationMs: 5200 },
            );
            return;
          }
          try {
            const ok = await ensureActiveAccount({ redirectTo: `worker:${p.workerId}` });
            if (!ok) return;
            const res = await openOrCreateChat(user.id, {
              workerUserId: p.workerId,
              workerDisplayName: p.workerFirstName,
              primaryTrade: p.trade,
            });
            const trade = res.primaryTrade || p.trade;
            navigation.navigate('ChatConversation', {
              conversationId: res.conversationId,
              otherDisplayName: res.workerDisplayName,
              headerSubtitle: trade ? `Profesional · ${trade}` : 'Profesional',
              workerId: p.workerId,
            });
          } catch (e) {
            const stillOk = await ensureActiveAccount({ redirectTo: `worker:${p.workerId}` });
            if (!stillOk) return;
            toast.error(e instanceof Error ? e.message : 'No se pudo abrir el chat.', 'Chat');
          }
        }}
        onRequestDelete={isOwner ? () => void confirmDelete() : undefined}
        onRequestHide={!isOwner && user ? () => void hideForMe() : undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  muted: { color: colors.textSecondary, textAlign: 'center', fontSize: 16 },
  backBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  backBtnText: { color: '#fff', fontWeight: '800' },
  pressed: { opacity: 0.85 },
});
