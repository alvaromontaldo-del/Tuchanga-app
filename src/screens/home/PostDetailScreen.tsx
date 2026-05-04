import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { deletePostInSupabase, hidePostInSupabase } from '../../services/supabasePosts';

type Props = FeedStackScreenProps<'PostDetail'>;

export function PostDetailScreen({ route, navigation }: Props) {
  const { postId } = route.params;
  const { posts, toggleLike, removePostLocal } = useFeed();
  const { user } = useAuth();
  const toast = useAppToast();
  const [busy, setBusy] = useState<'none' | 'delete' | 'hide'>('none');

  const post = useMemo(() => posts.find((p) => p.id === postId) ?? null, [posts, postId]);

  if (!post) {
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
      // Optimistic: desaparece del feed local inmediatamente.
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
            openAuthModal('Login');
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
            toast.error(e instanceof Error ? e.message : 'No se pudo abrir el chat', 'Chat', {
              durationMs: 4200,
            });
          }
        }}
        onRequestDelete={
          isOwner
            ? () => {
                void confirmDelete();
              }
            : undefined
        }
        onRequestHide={
          user && user.id !== p.workerId
            ? () => {
                void hideForMe();
              }
            : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { color: colors.textSecondary, fontWeight: '700', textAlign: 'center' },
  backBtn: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: 14 },
  backBtnText: { color: '#fff', fontWeight: '900' },
  pressed: { opacity: 0.92 },
});

