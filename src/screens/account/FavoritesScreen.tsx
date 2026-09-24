import { Ionicons } from '@expo/vector-icons';
import { useScrollToTop } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WorkerResultCard } from '../../components/search/WorkerResultCard';
import { colors, spacing } from '../../constants/theme';
import { useFavorites } from '../../context/FavoritesContext';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import { listKey } from '../../utils/safeAsync';

type Props = AccountStackScreenProps<'Favorites'>;

export function FavoritesScreen({ navigation }: Props) {
  const { favorites, isLoading, refresh, toggleFavoriteById } = useFavorites();
  const listRef = useRef<FlatList<string> | null>(null);
  useScrollToTop(listRef);

  useEffect(() => {
    // Cargar al entrar (si ya está cargado, refresh es idempotente).
    void refresh();
  }, [refresh]);

  const data = useMemo(() => favorites.map((x) => x.id), [favorites]);
  const byId = useMemo(() => new Map(favorites.map((x) => [x.id, x])), [favorites]);

  const onUnfavorite = useCallback(
    async (id: string) => {
      const optimistic = byId.get(id);
      try {
        await toggleFavoriteById({ professionalId: id, optimisticData: optimistic });
      } catch {
        // El toast lo dispara el contexto si hicimos refresh; acá solo evitamos crash.
      }
    },
    [byId, toggleFavoriteById],
  );

  const goToWorkerProfile = useCallback(
    (workerId: string) => {
      const parent = navigation.getParent();
      // Buscar ya no es tab: vamos por Inicio → WorkerProfile.
      (parent as any)?.navigate?.('Inicio', {
        screen: 'WorkerProfile',
        params: { workerId },
      });
    },
    [navigation],
  );

  const empty = !isLoading && data.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {empty ? (
        <View style={styles.empty}>
          <Ionicons name="heart-outline" size={48} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>Todavía no tenés favoritos</Text>
          <Text style={styles.emptyText}>
            Marcá profesionales con el corazón para verlos acá.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            onPress={() => ((navigation.getParent() as any) ?? navigation).navigate?.('Inicio', { screen: 'SearchWorker' })}
          >
            <Text style={styles.ctaText}>Buscar profesionales</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(id, index) => listKey(id, index, 'fav')}
          contentContainerStyle={styles.listContent}
          onRefresh={() => void refresh()}
          refreshing={isLoading}
          ListHeaderComponent={
            isLoading && data.length === 0 ? (
              <View style={styles.loadingTop}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Cargando favoritos…</Text>
              </View>
            ) : null
          }
          renderItem={({ item: id }) => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <WorkerResultCard
                worker={{
                  id: p.id,
                  firstName: p.firstName,
                  summary: p.summary,
                  avatarUrl: p.avatarUrl,
                  ratingAverage: p.ratingAverage,
                  reviewCount: p.reviewCount,
                }}
                onPress={() => goToWorkerProfile(p.id)}
                showChevron
                rightAccessory={
                  <Pressable
                    onPress={() => void onUnfavorite(p.id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Quitar de favoritos"
                    style={({ pressed }) => [styles.heartBtn, pressed && styles.pressed]}
                  >
                    <Ionicons name="heart" size={20} color="#DC2626" />
                  </Pressable>
                }
              />
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl * 2 },
  loadingTop: { paddingTop: spacing.xl, alignItems: 'center' },
  loadingText: { marginTop: spacing.md, color: colors.textSecondary, fontWeight: '600' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    marginTop: spacing.md,
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  heartBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220,38,38,0.08)',
  },
  pressed: { opacity: 0.9 },
});

