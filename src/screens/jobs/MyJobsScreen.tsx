import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PostCard } from '../../components/feed/PostCard';
import { colors, radii, spacing } from '../../constants/theme';
import { useFeed } from '../../context/FeedContext';
import type { MyJobsScreenNavigation } from '../../navigation/mainTypes';
import { CURRENT_USER_WORKER_ID } from '../../types/feed';
import { accountUi } from '../account/accountUi';

/**
 * Publicaciones del usuario actual (mismo origen que el feed: FeedContext).
 * Header nativo del stack Perfil: título y volver atrás.
 */
export function MyJobsScreen() {
  const navigation = useNavigation<MyJobsScreenNavigation>();
  const { posts, toggleLike } = useFeed();

  const myPosts = useMemo(
    () => posts.filter((p) => p.workerId === CURRENT_USER_WORKER_ID),
    [posts],
  );

  function goPublish() {
    navigation.navigate('Inicio', { screen: 'PublishPost' });
  }

  function openProfile(workerId: string) {
    navigation.navigate('Inicio', {
      screen: 'WorkerProfile',
      params: { workerId },
    });
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
          <View style={styles.emptyCard}>
            <Ionicons name="images-outline" size={46} color={colors.border} />
            <Text style={styles.emptyTitle}>Todavía no tenés publicaciones</Text>
            <Text style={styles.emptyText}>
              Usá el botón Publicar en la barra inferior (con modo trabajador activo en Perfil).
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
        ) : (
          <>
            {myPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onToggleLike={() => toggleLike(post.id)}
                onOpenProfile={() => openProfile(post.workerId)}
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
    paddingHorizontal: spacing.lg,
  },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
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
