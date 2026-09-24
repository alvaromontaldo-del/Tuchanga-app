import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostCard } from '../../components/feed/PostCard';
import { useAppToast } from '../../components/toast/toast';
import { colors, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useFeed } from '../../context/FeedContext';
import type { FeedStackParamList } from '../../navigation/mainTypes';
import { openAuthModal } from '../../navigation/openAuthModal';
import { RubroMultiSelectModal } from '../../components/search/RubroMultiSelectModal';
import { isMessagingAvailable } from '../../config/api';
import { isSupabaseConfigured } from '../../config/supabase';
import { openOrCreateChat } from '../../services/messaging';
import { deletePostInSupabase, hidePostInSupabase } from '../../services/supabasePosts';
import { fetchActiveTradeNamesFromSupabase } from '../../services/workerTradesSupabase';
import { SearchHeaderBar } from '../../components/search/SearchHeaderBar';

type Nav = NativeStackNavigationProp<FeedStackParamList>;
type HomeRoute = RouteProp<FeedStackParamList, 'Home'>;

/**
 * Feed principal: prioriza el contenido; cuenta y modo trabajador viven en Perfil.
 */
export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<HomeRoute>();
  const toast = useAppToast();
  const { posts, toggleLike, refresh, removePostLocal } = useFeed();
  const { user, flashMessage, setFlashMessage, ensureActiveAccount } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const isFocusedScreen = useIsFocused();
  const navLockRef = useRef(false);
  const navUnlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [allowedTrades, setAllowedTrades] = useState<string[]>([]);
  const [allowedLoading, setAllowedLoading] = useState(false);

  const [headerHeight, setHeaderHeight] = useState(120);
  const headerTranslateY = useRef(new Animated.Value(0)).current;
  const lastScrollYRef = useRef(0);
  const headerHiddenRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);

  useFocusEffect(
    useCallback(() => {
      // UX pedida: al volver a Home, no persisten filtros/labels del buscador.
      setQuery('');
      setSelectedCategories([]);
      lastScrollYRef.current = 0;
      headerHiddenRef.current = false;
      headerTranslateY.setValue(0);
    }, [headerTranslateY]),
  );

  const onHeaderLayout = useCallback((h: number) => {
    const next = Math.max(88, Math.round(h));
    setHeaderHeight((prev) => (prev === next ? prev : next));
  }, []);

  const onFeedScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;

      const H = headerHeight;
      if (H <= 0) return;

      let hidden = headerHiddenRef.current;

      // Cerca del tope: siempre mostrar header (evita “huecos” raros al overscroll).
      if (y <= 8) {
        hidden = false;
      } else if (dy > 2 && y > 24) {
        // Scroll hacia abajo: ocultar (umbral bajo para no “pelear” con el rebote).
        hidden = true;
      } else if (dy < -2) {
        // Scroll hacia arriba: mostrar
        hidden = false;
      }

      const next = hidden ? -H : 0;
      if (headerHiddenRef.current !== hidden) {
        headerHiddenRef.current = hidden;
        headerTranslateY.setValue(next);
      }
    },
    [headerHeight, headerTranslateY],
  );

  useEffect(() => {
    // Si cambia el alto real del header (p.ej. aparece/desaparece el chip), mantenemos el offset coherente.
    const H = headerHeight;
    if (H <= 0) return;
    headerTranslateY.setValue(headerHiddenRef.current ? -H : 0);
  }, [headerHeight, headerTranslateY]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    setAllowedLoading(true);
    void fetchActiveTradeNamesFromSupabase()
      .then((names) => {
        if (!cancelled) setAllowedTrades(names);
      })
      .catch(() => {
        // silencio: si falla, mostramos catálogo completo (mejor que bloquear).
      })
      .finally(() => {
        if (!cancelled) setAllowedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onRefreshFeed = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      /* el feed ya loguea el fallo; el pull-to-refresh no debe rechazar */
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const scrollToTopAndRefresh = useCallback(() => {
    lastScrollYRef.current = 0;
    headerHiddenRef.current = false;
    headerTranslateY.setValue(0);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    void onRefreshFeed();
  }, [headerTranslateY, onRefreshFeed]);

  useEffect(() => {
    const token = route.params?.scrollToTopToken;
    if (token == null) return;
    scrollToTopAndRefresh();
    navigation.setParams({ scrollToTopToken: undefined });
  }, [route.params?.scrollToTopToken, navigation, scrollToTopAndRefresh]);

  useEffect(() => {
    return () => {
      if (navUnlockTimer.current) clearTimeout(navUnlockTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!flashMessage) return;
    const t = setTimeout(() => {
      toast.info(flashMessage, 'YaChanga');
      setFlashMessage(null);
    }, 80);
    return () => clearTimeout(t);
  }, [flashMessage, setFlashMessage, toast]);

  return (
    <View style={styles.safe}>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.smartHeaderWrap,
          { transform: [{ translateY: headerTranslateY }] },
        ]}
        onLayout={(e) => onHeaderLayout(e.nativeEvent.layout.height)}
      >
        <SearchHeaderBar
          value={query}
          onChangeText={setQuery}
          onPressFilters={() => setFilterOpen(true)}
          filtersLabel={allowedLoading ? 'Cargando…' : 'Filtros'}
          mode="launcher"
          onPressLauncher={() => {
            if (!isFocusedScreen) return;
            if (navLockRef.current) return;
            navLockRef.current = true;
            navigation.navigate('SearchWorker', {
              initialQuery: query.trim(),
              initialCategories: selectedCategories,
              openFilters: false,
            });
            if (navUnlockTimer.current) clearTimeout(navUnlockTimer.current);
            navUnlockTimer.current = setTimeout(() => {
              navLockRef.current = false;
              navUnlockTimer.current = null;
            }, 500);
          }}
          onSubmit={() => {
            navigation.navigate('SearchWorker', {
              initialQuery: query.trim(),
              initialCategories: selectedCategories,
              openFilters: false,
            });
          }}
          showLogo
          selectedLabel={selectedCategories[0] ?? null}
          onClearSelected={() => setSelectedCategories([])}
        />
      </Animated.View>

      <RubroMultiSelectModal
        visible={filterOpen}
        title="Oficios"
        initialSelected={selectedCategories}
        allowedNames={allowedTrades.length ? allowedTrades : undefined}
        singleSelect
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setSelectedCategories(next);
          setFilterOpen(false);
          navigation.navigate('SearchWorker', {
            initialQuery: query.trim(),
            initialCategories: next,
            openFilters: false,
          });
        }}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            // El header ya incluye safe area; acá solo compensamos su alto.
            paddingTop: headerHeight + spacing.sm,
            paddingBottom: insets.bottom + spacing.md,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={onFeedScroll}
        alwaysBounceVertical
        {...(Platform.OS === 'android' ? { overScrollMode: 'always' as const } : {})}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefreshFeed}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressViewOffset={headerHeight + spacing.sm}
          />
        }
      >
        <View style={styles.header}>
          {!user ? (
            <Pressable
              onPress={() => openAuthModal('Login')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Entrá o registrate"
              style={styles.guestLinkWrap}
            >
              <Text style={styles.guestLink}>Entrá o registrate</Text>
            </Pressable>
          ) : null}
          <Text style={styles.tagline}>Trabajos y recomendaciones</Text>
        </View>

        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onToggleLike={() => toggleLike(post.id)}
            onOpenProfile={() => navigation.navigate('WorkerProfile', { workerId: post.workerId })}
            showMessageButton={Boolean(user && user.id !== post.workerId)}
            onOpenMessage={async () => {
              if (!user) {
                openAuthModal('Register', { redirectTo: `worker:${post.workerId}` });
                return;
              }
              if (user.id === post.workerId) return;
              if (!isMessagingAvailable()) {
                toast.warning(
                  'Agregá Supabase o el servidor de mensajería (EXPO_PUBLIC_API_URL) para chatear.',
                  'Configurar chat',
                  { durationMs: 5200 },
                );
                return;
              }
              try {
                const ok = await ensureActiveAccount({
                  redirectTo: `worker:${post.workerId}`,
                });
                if (!ok) return;
                const res = await openOrCreateChat(user.id, {
                  workerUserId: post.workerId,
                  workerDisplayName: post.workerFirstName,
                  primaryTrade: post.trade,
                });
                const trade = res.primaryTrade || post.trade;
                navigation.navigate('ChatConversation', {
                  conversationId: res.conversationId,
                  otherDisplayName: res.workerDisplayName,
                  headerSubtitle: trade ? `Profesional · ${trade}` : 'Profesional',
                  workerId: post.workerId,
                });
              } catch (e) {
                const stillOk = await ensureActiveAccount({
                  redirectTo: `worker:${post.workerId}`,
                });
                if (!stillOk) return;
                toast.error(
                  e instanceof Error ? e.message : 'No se pudo abrir el chat',
                  'Chat',
                  { durationMs: 4200 },
                );
              }
            }}
            onRequestDelete={
              user?.id === post.workerId
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
                : undefined
            }
            onRequestHide={
              user && user.id !== post.workerId
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
                              toast.success('Listo. No la vas a ver más en tu inicio.', 'Ocultada');
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
        ))}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
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
  },
  smartHeaderWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 30,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  tagline: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  guestLinkWrap: {
    paddingVertical: 2,
    alignSelf: 'flex-end',
  },
  guestLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  bottomSpacer: {
    height: spacing.lg,
  },
});
