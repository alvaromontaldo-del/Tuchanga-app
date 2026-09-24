import { Ionicons } from '@expo/vector-icons';
import { useScrollToTop } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppScreen } from '../../components/layout/AppScreen';
import { RubroMultiSelectModal } from '../../components/search/RubroMultiSelectModal';
// Punto de referencia: siempre domicilio del perfil (sin selector).
import { WorkerResultCard } from '../../components/search/WorkerResultCard';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { useAuth } from '../../context/AuthContext';
import type { AuthUser } from '../../services/auth';
import { fetchSearchWorkerHitsFromSupabase } from '../../services/searchWorkersSupabase';
import { getSupabaseClient } from '../../lib/supabase';
import { SearchHeaderBar } from '../../components/search/SearchHeaderBar';
import { fetchActiveTradeNamesFromSupabase } from '../../services/workerTradesSupabase';
import {
  SEARCH_WORKERS,
  searchWorkerHits,
  type SearchWorkerHit,
} from '../../data/mockSearchWorkers';
import type { FeedStackScreenProps } from '../../navigation/mainTypes';
import { openAuthModal } from '../../navigation/openAuthModal';
import { listKey } from '../../utils/safeAsync';
// Sin GPS en Buscar: usamos domicilio del perfil.

function summaryMulti(selected: string[], emptyLabel: string): string {
  if (selected.length === 0) return emptyLabel;
  if (selected.length <= 2) return selected.join(', ');
  return `${selected.length} seleccionados`;
}

function formatKm(d: number): string {
  if (d < 1) return `${Math.round(d * 1000)} m`;
  return `${d.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function hasValidBaseLocation(user: AuthUser | null): boolean {
  const b = user?.baseLocation;
  if (!b) return false;
  if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return false;
  // Muchos fallos de parseo de geography caen en (0,0). No lo consideramos válido.
  if (b.lat === 0 && b.lng === 0) return false;
  if (!b.address?.trim() || b.address.trim().length < 4) return false;
  return true;
}

/**
 * Búsqueda por texto y rubro; visibilidad por ubicación: solo trabajadores cuyo radio cubre el domicilio del perfil.
 */
export function SearchWorkerScreen({ route, navigation }: FeedStackScreenProps<'SearchWorker'>) {
  const { user, isRestoring } = useAuth();
  const [query, setQuery] = useState(route.params?.initialQuery ?? '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    route.params?.initialCategories ?? [],
  );
  const [categoryModal, setCategoryModal] = useState(false);
  const [allowedTrades, setAllowedTrades] = useState<string[]>([]);
  const [allowedLoading, setAllowedLoading] = useState(false);

  // Sin sesión: ir a Login (no toast de “falta domicilio”).
  useEffect(() => {
    if (isRestoring) return;
    if (user) return;
    openAuthModal('Login');
  }, [isRestoring, user]);

  const effectiveClientPos = useMemo(() => {
    if (hasValidBaseLocation(user)) {
      const b = user!.baseLocation!;
      return { lat: b.lat, lng: b.lng };
    }
    return null;
  }, [user]);

  const [hits, setHits] = useState<SearchWorkerHit[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  const [hitsError, setHitsError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [debugLine, setDebugLine] = useState<string>('');
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<string>('');
  const listRef = useRef<FlatList<SearchWorkerHit> | null>(null);
  useScrollToTop(listRef);
  // Entradas desde HOME header: hidratamos búsqueda/filtros.
  useEffect(() => {
    if (route.params?.initialQuery !== undefined) {
      setQuery(route.params.initialQuery ?? '');
    }
    if (route.params?.initialCategories) {
      setSelectedCategories(route.params.initialCategories);
    }
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    if (route.params?.openFilters) {
      openTimer = setTimeout(() => setCategoryModal(true), 50);
    }
    return () => {
      if (openTimer) clearTimeout(openTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.initialQuery, route.params?.initialCategories?.join('|'), route.params?.openFilters]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    setAllowedLoading(true);
    void fetchActiveTradeNamesFromSupabase()
      .then((names) => {
        if (!cancelled) setAllowedTrades(names);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setAllowedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const hasSearchPoint = effectiveClientPos != null;
  const clientLat = effectiveClientPos?.lat;
  const clientLng = effectiveClientPos?.lng;

  useEffect(() => {
    if (!hasSearchPoint || clientLat == null || clientLng == null) {
      setHits([]);
      setHitsLoading(false);
      setHitsError(null);
      setDebugLine('Sin domicilio válido en tu perfil.');
      return;
    }

    if (!isSupabaseConfigured()) {
      setHits(searchWorkerHits(SEARCH_WORKERS, query, selectedCategories, effectiveClientPos));
      setHitsLoading(false);
      setHitsError(null);
      setDebugLine('Modo demo (sin Supabase).');
      return;
    }

    if (isRestoring) {
      setHitsLoading(true);
      setHitsError(null);
      setDebugLine('Restaurando sesión…');
      return;
    }

    let cancelled = false;
    setHitsLoading(true);
    setHitsError(null);
    setDebugLine(
      `Buscando en Supabase (lat ${clientLat.toFixed(4)}, lng ${clientLng.toFixed(4)})…`,
    );
    void (async () => {
      try {
        const data = await fetchSearchWorkerHitsFromSupabase({
          clientLat,
          clientLng,
          query,
          categoryNames: selectedCategories,
          excludeUserId: user?.id,
        });
        if (!cancelled) {
          setHits(data);
          setDebugLine(
            `Supabase OK · ${data.length} resultado(s) · excluye: ${user?.id ? 'sí' : 'no'}`,
          );
        }
      } catch (e) {
        if (!cancelled) {
          setHits([]);
          setHitsError(e instanceof Error ? e.message : 'No se pudo cargar la búsqueda.');
          setDebugLine('Error al consultar Supabase.');
        }
      } finally {
        if (!cancelled) setHitsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasSearchPoint,
    clientLat,
    clientLng,
    query,
    selectedCategories,
    user?.id,
    searchRetry,
    isRestoring,
  ]);

  const useSupabaseSearch = isSupabaseConfigured();

  const triggerSearch = useCallback(() => {
    setSearchRetry((n) => n + 1);
  }, []);

  function openSettings() {
    if (Platform.OS === 'web') return;
    void Linking.openSettings();
  }

  async function runDiagnostics() {
    if (!hasSearchPoint || clientLat == null || clientLng == null) {
      setDiagResult('No hay domicilio válido en tu perfil.');
      return;
    }
    if (!isSupabaseConfigured()) {
      setDiagResult('Supabase no está configurado en esta build.');
      return;
    }
    setDiagRunning(true);
    try {
      const sb = getSupabaseClient();
      await sb.auth.getSession();

      // 1) RPC sin excluir (debería devolver "alguien" si existe algún worker visible cerca)
      const rpcAll = await fetchSearchWorkerHitsFromSupabase({
        clientLat,
        clientLng,
        query: '',
        categoryNames: [],
      });

      // 2) Perfil + jobs del usuario actual (si hay sesión)
      const meId = user?.id ?? null;
      type MeProfileRow = { coverage_km: number | null; direccion_texto: string | null };
      let meProfile: MeProfileRow | null = null;
      let meJobsCount: number | null = null;
      if (meId) {
        const pr = await sb
          .from('profiles')
          .select('coverage_km,direccion_texto')
          .eq('id', meId)
          .maybeSingle();
        if (!pr.error) meProfile = (pr.data as MeProfileRow | null) ?? null;

        const jr = await sb.from('jobs').select('id', { count: 'exact', head: true }).eq('user_id', meId);
        if (!jr.error) meJobsCount = jr.count ?? 0;
      }

      // 3) Conteo global simple (para saber si hay datos en DB)
      const profilesWithCoverage = await sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .not('coverage_km', 'is', null);
      const totalJobs = await sb.from('jobs').select('id', { count: 'exact', head: true });

      const ids = rpcAll.slice(0, 3).map((h) => h.worker.id);
      const lines = [
        `Punto: lat ${clientLat.toFixed(4)}, lng ${clientLng.toFixed(4)}`,
        `RPC ⇒ ${rpcAll.length} resultado(s)` + (ids.length ? ` (ej: ${ids.join(', ')})` : ''),
        `Yo: ${meId ? 'sí' : 'no'} | coverage_km: ${meProfile?.coverage_km ?? 'n/a'} | jobs míos: ${
          meJobsCount ?? 'n/a'
        }`,
        `DB: perfiles con coverage_km: ${profilesWithCoverage.count ?? 'n/a'} | jobs totales: ${
          totalJobs.count ?? 'n/a'
        }`,
      ];
      setDiagResult(lines.join('\n'));
    } catch (e) {
      setDiagResult(`Error RPC: ${e instanceof Error ? e.message : 'desconocido'}`);
    } finally {
      setDiagRunning(false);
    }
  }

  function listEmptyMessage(): {
    title: string;
    text: string;
    showRetry?: boolean;
    showRetrySearch?: boolean;
    showSettings?: boolean;
    showPickAddress?: boolean;
  } {
    if (!user && !isRestoring) {
      return {
        title: 'Iniciá sesión',
        text: 'Para buscar profesionales necesitás una cuenta con domicilio cargado.',
      };
    }
    if (!hasSearchPoint) {
      return {
        title: 'Falta tu domicilio',
        text: 'Para buscar profesionales, cargá tu domicilio en Perfil → Mis datos. La app usa ese punto para comparar coberturas.',
      };
    }
    if (hitsError) {
      return {
        title: 'Error al buscar',
        text: hitsError,
        showRetrySearch: true,
        showPickAddress: true,
      };
    }
    if (useSupabaseSearch && hitsLoading && hits.length === 0) {
      return {
        title: 'Buscando profesionales',
        text: 'Consultando resultados cerca de tu punto de referencia…',
      };
    }
    if (hits.length === 0) {
      return {
        title: 'Sin resultados cerca',
        text: 'No hay profesionales que coincidan con tu búsqueda dentro de su radio de cobertura. Probá otra palabra u otro oficio.',
      };
    }
    return { title: '', text: '' };
  }

  const empty = listEmptyMessage();
  const showBlockingLoading =
    hasSearchPoint && useSupabaseSearch && hitsLoading && !hitsError && hits.length === 0;
  const showEmpty = !hasSearchPoint || hits.length === 0;

  return (
    <AppScreen style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <SearchHeaderBar
        value={query}
        onChangeText={(t) => {
          setQuery(t);
        }}
        onPressFilters={() => setCategoryModal(true)}
        filtersLabel={allowedLoading ? 'Cargando…' : 'Filtros'}
        autoFocus
        onSubmit={triggerSearch}
        showLogo
        selectedLabel={selectedCategories[0] ?? null}
        onClearSelected={() => {
          setSelectedCategories([]);
          triggerSearch();
        }}
      />

      <FlatList
        ref={listRef}
        data={showEmpty ? [] : hits}
        keyExtractor={(item, index) => listKey(item?.worker?.id, index, 'worker')}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            {showBlockingLoading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : hitsError ? (
              <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
            ) : (
              <Ionicons name="location-outline" size={48} color={colors.border} />
            )}
            <Text style={styles.emptyTitle}>{empty.title}</Text>
            <Text style={styles.emptyText}>{empty.text}</Text>
            {debugLine ? <Text style={styles.debug}>{debugLine}</Text> : null}
            <Pressable
              style={({ pressed }) => [
                styles.retryBtn,
                styles.retryBtnSecondary,
                pressed && styles.pressed,
              ]}
              onPress={() => void runDiagnostics()}
              disabled={diagRunning}
            >
              <Text style={styles.retryBtnText}>
                {diagRunning ? 'Diagnosticando…' : 'Diagnosticar búsqueda'}
              </Text>
            </Pressable>
            {diagResult ? <Text style={styles.debug}>{diagResult}</Text> : null}
            {empty.showRetrySearch ? (
              <Pressable
                style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
                onPress={() => {
                  setHitsError(null);
                  setSearchRetry((n) => n + 1);
                }}
              >
                <Text style={styles.retryBtnText}>Reintentar búsqueda</Text>
              </Pressable>
            ) : null}
            {empty.showSettings ? (
              <Pressable
                style={({ pressed }) => [styles.settingsBtn, pressed && styles.pressed]}
                onPress={openSettings}
              >
                <Text style={styles.settingsBtnText}>Abrir ajustes</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <WorkerResultCard
            worker={{
              id: item.worker.id,
              firstName: item.worker.firstName,
              summary: item.worker.summary,
              avatarUrl: item.worker.avatarUrl,
              ratingAverage: item.worker.ratingAverage,
              reviewCount: item.worker.reviewCount,
              distanceLabel: `A ${formatKm(item.distanceKm)}`,
            }}
            highlightQuery={query}
            onPress={() =>
              navigation.navigate('WorkerProfile', { workerId: item.worker.id })
            }
          />
        )}
      />

      <RubroMultiSelectModal
        visible={categoryModal}
        title="Oficios"
        initialSelected={selectedCategories}
        allowedNames={allowedTrades.length ? allowedTrades : undefined}
        singleSelect
        onClose={() => {
          setCategoryModal(false);
          triggerSearch();
        }}
        onApply={(next) => {
          setSelectedCategories(next);
          triggerSearch();
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  originCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  originCardLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  originCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xs,
  },
  originCardDetail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  originActions: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  originBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 12,
  },
  originBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  originLink: { alignItems: 'center', paddingVertical: 8 },
  originLinkText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  originSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  originSecondaryText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
    flexGrow: 1,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  debug: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  retryBtnText: { color: '#fff', fontWeight: '800' },
  retryBtnSecondary: {
    backgroundColor: colors.text,
    marginTop: spacing.sm,
  },
  settingsBtn: {
    marginTop: spacing.md,
    paddingVertical: 12,
  },
  settingsBtnText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 16,
  },
  pressed: { opacity: 0.92 },
});
