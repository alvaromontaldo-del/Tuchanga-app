import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChangaPostListRow } from '../../components/feed/ChangaPostListRow';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAppToast } from '../../components/toast/toast';
import { useFeed } from '../../context/FeedContext';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured } from '../../config/supabase';
import type { MyJobsScreenNavigation } from '../../navigation/mainTypes';
import { deletePostInSupabase } from '../../services/supabasePosts';
import { accountUi } from '../account/accountUi';

/**
 * Publicaciones del usuario actual (mismo origen que el feed: FeedContext).
 * Vista lista alineada con búsqueda (ChangaCard).
 */
export function MyJobsScreen() {
  const navigation = useNavigation<MyJobsScreenNavigation>();
  const { posts, removePostLocal } = useFeed();
  const { user } = useAuth();
  const toast = useAppToast();

  const myPosts = useMemo(
    () => (user?.id ? posts.filter((p) => p.workerId === user.id) : []),
    [posts, user?.id],
  );

  function goPublish() {
    navigation.navigate('Inicio', { screen: 'PublishPost' });
  }

  function openPostDetail(postId: string) {
    navigation.navigate('Inicio', { screen: 'PostDetail', params: { postId } });
  }

  return (
    <SafeAreaView style={accountUi.screenBg} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={[accountUi.scrollContent, styles.scrollInner]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Lo que publicaste como trabajador (las mismas publicaciones que en Inicio).
        </Text>

        {myPosts.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyCard}>
              <Ionicons name="images-outline" size={46} color={colors.border} />
              <Text style={styles.emptyTitle}>Todavía no tenés publicaciones</Text>
              <Text style={styles.emptyText}>
                Usá el botón Publicar en la barra inferior.
              </Text>
              <Pressable
                onPress={goPublish}
                style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Ir a publicar un trabajo"
              >
                <Text style={styles.ctaText}>Publicar trabajo</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            {myPosts.map((post) => (
              <ChangaPostListRow
                key={post.id}
                post={post}
                onPress={() => openPostDetail(post.id)}
                onPressMenu={() => {
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
                }}
              />
            ))}
            <View style={styles.bottomSpacer} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollInner: {
    paddingTop: spacing.md,
    paddingHorizontal: 0,
  },
  lead: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  emptyWrap: {
    paddingHorizontal: 0,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    marginHorizontal: spacing.lg,
  },
  emptyTitle: { marginTop: spacing.md, fontSize: 17, fontWeight: '800', color: colors.text },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  ctaText: { color: '#fff', fontWeight: '800' },
  pressed: { opacity: 0.92 },
  bottomSpacer: { height: 24 },
});
