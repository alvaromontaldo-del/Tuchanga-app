import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { RubroMultiSelectModal } from '../../components/search/RubroMultiSelectModal';
// Punto de referencia: siempre domicilio del perfil (sin selector).
import { IntegerRatingStars } from '../../components/profile/IntegerRatingStars';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { useAuth } from '../../context/AuthContext';
import type { AuthUser } from '../../services/auth';
import { fetchSearchWorkerHitsFromSupabase } from '../../services/searchWorkersSupabase';
import { getSupabaseClient } from '../../lib/supabase';
import {
  SEARCH_WORKERS,
  searchWorkerHits,
  type SearchWorkerHit,
} from '../../data/mockSearchWorkers';
import type { SearchStackParamList } from '../../navigation/mainTypes';
// Sin GPS en Buscar: usamos domicilio del perfil.

type Nav = NativeStackNavigationProp<SearchStackParamList>;

function summaryMulti(selected: string[], emptyLabel: string): string {
  if (selected.length === 0) return emptyLabel;
  if (selected.length <= 2) return selected.join(', ');
  return `${selected.length} seleccionados`;
}

function formatKm(d: number): string {
  if (d < 1) return `${Math.round(d * 1000)} m`;
  return `${d.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function ResultRow({
  hit,
  onPress,
}: {
  hit: SearchWorkerHit;
  onPress: () => void;
}) {
  const { worker, distanceKm } = hit;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.resultCard, pressed && styles.resultPressed]}
    >
      <Image source={{ uri: worker.avatarUrl }} style={styles.resultAvatar} />
      <View style={styles.resultBody}>
        <Text style={styles.resultName}>{worker.firstName}</Text>
        <Text style={styles.resultSummary} numberOfLines={2}>
          {worker.summary}
        </Text>
        <View style={styles.resultMeta}>
          <IntegerRatingStars rating={Math.round(worker.ratingAverage)} size={16} />
          <Text style={styles.resultScore}>{worker.ratingAverage.toFixed(1)}</Text>
          <Text style={styles.resultReviews}>
            ({worker.reviewCount}{' '}
            {worker.reviewCount === 1 ? 'reseña' : 'reseñas'})
          </Text>
        </View>
        <Text style={styles.resultDistance} numberOfLines={1}>
          A {formatKm(distanceKm)} · Radio {worker.coverageKm} km
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
    </Pressable>
  );
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
export function SearchWorkerScreen() {
  const navigation = useNavigation<Nav>();
  const { user, isRestoring } = useAuth();
  const [query, setQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryModal, setCategoryModal] = useState(false);

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.screenTitle}>Buscar trabajador</Text>
        <Text style={styles.screenSubtitle}>
          El radio de cada profesional se compara con el domicilio de tu perfil.
        </Text>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={22} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Nombre, oficio o palabra clave"
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.filtersBlock}>
        <Text style={styles.filterLabel}>Oficio</Text>
        <Pressable
          style={styles.dropdown}
          onPress={() => setCategoryModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Abrir filtro de oficios"
        >
          <Text style={styles.dropdownText} numberOfLines={1}>
            {summaryMulti(selectedCategories, 'Todos los oficios')}
          </Text>
          <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <FlatList
        data={showEmpty ? [] : hits}
        keyExtractor={(item) => item.worker.id}
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
          <ResultRow
            hit={item}
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
        onClose={() => setCategoryModal(false)}
        onApply={setSelectedCategories}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brandRow: {
    marginBottom: spacing.sm,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 22,
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    color: colors.text,
    paddingVertical: 0,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  filtersBlock: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dropdownText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
    marginRight: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
    flexGrow: 1,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultPressed: {
    opacity: 0.92,
  },
  resultAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E5E5E5',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  resultBody: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  resultName: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  resultSummary: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  resultScore: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginLeft: 8,
  },
  resultReviews: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 6,
  },
  resultDistance: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
    fontWeight: '600',
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
