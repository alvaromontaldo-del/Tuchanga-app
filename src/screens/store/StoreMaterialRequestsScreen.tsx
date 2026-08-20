import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components/common/AppButton';
import { useAppToast } from '../../components/toast/toast';
import { colors, radii, spacing } from '../../constants/theme';
import { useCommerceShell } from '../../context/CommerceShellContext';
import { useStoreBoardCards } from '../../hooks/useStoreQuotes';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import { completarOrdenMaterialConPin, formatMoneyAr } from '../../services/clientQuotesSupabase';
import { storeCanReceiveQuotes, storeStatusLabel } from '../../services/storeRegistrationSupabase';
import type { StoreBoardCard, StoreBoardColumn } from '../../types/materials';
import { normalizeOrderCodeInput } from '../../utils/orderCode';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<CommerceStackParamList, 'StoreMaterialRequests'>;

const FILTER_TABS: { id: StoreBoardColumn; label: string }[] = [
  { id: 'nuevas', label: 'Nuevas' },
  { id: 'cotizadas', label: 'Cotizadas' },
  { id: 'confirmadas', label: 'Confirmadas' },
  { id: 'cerradas', label: 'Cerradas' },
  { id: 'rechazadas', label: 'Rechazadas' },
];

const EMPTY_HINT: Record<StoreBoardColumn, string> = {
  nuevas: 'No hay solicitudes nuevas por cotizar.',
  cotizadas: 'No hay cotizaciones pendientes de respuesta del cliente.',
  confirmadas: 'No hay pedidos confirmados (fee pagado) para preparar.',
  cerradas: 'Todavía no hay entregas cerradas con PIN.',
  rechazadas: 'No hay cotizaciones rechazadas por el cliente.',
};

/**
 * Tablero del comercio: tabs = estados + lista vertical del filtro activo.
 */
export function StoreMaterialRequestsScreen({ navigation, route }: Props) {
  const toast = useAppToast();
  const { cards, loading, error, refresh, refreshSilent } = useStoreBoardCards(true);
  const { primaryStore } = useCommerceShell();
  const canReceive = primaryStore ? storeCanReceiveQuotes(primaryStore.status) : false;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StoreBoardColumn>(
    () => route.params?.initialColumn ?? 'nuevas',
  );
  const [closingId, setClosingId] = useState<string | null>(null);
  const [pinByCard, setPinByCard] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchMiss, setSearchMiss] = useState(false);
  const listRef = useRef<FlatList<StoreBoardCard>>(null);
  const searchJumpRef = useRef<string>('');

  useEffect(() => {
    const col = route.params?.initialColumn;
    if (col && FILTER_TABS.some((t) => t.id === col)) {
      setFilter(col);
    }
    const targetId = route.params?.highlightTargetId;
    const requestId = route.params?.highlightRequestId;
    if (targetId) setHighlightId(targetId);
    else if (requestId) {
      const match = cards.find((c) => c.requestId === requestId);
      if (match) setHighlightId(match.targetId);
    }
  }, [route.params, cards]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Pedidos',
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('CommerceAccount')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Mi comercio"
          style={{ paddingHorizontal: 8 }}
        >
          <Ionicons name="person-circle-outline" size={26} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(() => {
        void refreshSilent();
      }, 8_000);
      return () => clearInterval(id);
    }, [refresh, refreshSilent]),
  );

  const countsByFilter = useMemo(() => {
    const counts: Record<StoreBoardColumn, number> = {
      nuevas: 0,
      cotizadas: 0,
      confirmadas: 0,
      cerradas: 0,
      rechazadas: 0,
    };
    for (const c of cards) counts[c.column] += 1;
    return counts;
  }, [cards]);

  // Buscador: si hay match exacto/parcial por código, salta al tab del estado.
  useEffect(() => {
    const q = normalizeOrderCodeInput(query);
    if (!q) {
      setSearchMiss(false);
      setHighlightId(null);
      searchJumpRef.current = '';
      return;
    }
    const matches = cards.filter((c) => {
      const code = normalizeOrderCodeInput(c.orderCode ?? '');
      return code.includes(q) || c.requestId.replace(/\D/g, '').includes(q);
    });
    if (matches.length === 0) {
      setSearchMiss(true);
      setHighlightId(null);
      return;
    }
    setSearchMiss(false);
    const best =
      matches.find((m) => normalizeOrderCodeInput(m.orderCode ?? '') === q) ?? matches[0];
    const jumpKey = `${best.targetId}:${best.column}:${q}`;
    if (searchJumpRef.current !== jumpKey) {
      searchJumpRef.current = jumpKey;
      setFilter(best.column);
      setHighlightId(best.targetId);
      setExpandedId(best.targetId);
    }
  }, [query, cards]);

  const list = useMemo(() => {
    const q = normalizeOrderCodeInput(query);
    return cards.filter((c) => {
      if (c.column !== filter) return false;
      if (!q) return true;
      const code = normalizeOrderCodeInput(c.orderCode ?? '');
      return code.includes(q) || c.requestId.replace(/\D/g, '').includes(q);
    });
  }, [cards, filter, query]);

  useEffect(() => {
    if (!highlightId || list.length === 0) return;
    const idx = list.findIndex((c) => c.targetId === highlightId);
    if (idx < 0) return;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.15 });
      } catch {
        /* ignore */
      }
    }, 120);
    return () => clearTimeout(t);
  }, [highlightId, list, filter]);

  const onOpenCard = useCallback(
    (card: StoreBoardCard) => {
      navigation.navigate('StoreQuoteRequest', {
        requestId: card.requestId,
        storeId: card.storeId,
      });
    },
    [navigation],
  );

  const onCloseOrder = useCallback(
    async (card: StoreBoardCard) => {
      if (!card.orderCode) {
        toast.warning('Esta tarjeta todavía no tiene código de orden.', 'Código');
        return;
      }
      const pin = pinByCard[card.targetId] ?? '';
      if (!pin.trim()) {
        toast.warning('Ingresá el PIN del cliente.', 'PIN');
        return;
      }
      setClosingId(card.targetId);
      try {
        await completarOrdenMaterialConPin(card.orderCode, pin);
        toast.success(`Orden ${card.orderCode} cerrada.`, 'Cerrada');
        setPinByCard((prev) => {
          const next = { ...prev };
          delete next[card.targetId];
          return next;
        });
        setFilter('cerradas');
        refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudo cerrar la orden.', 'Error');
      } finally {
        setClosingId(null);
      }
    },
    [pinByCard, refresh, toast],
  );

  return (
    <View style={styles.flex}>
      {primaryStore && !canReceive ? (
        <View style={styles.banner}>
          <Ionicons name="time-outline" size={20} color={colors.text} />
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>{storeStatusLabel(primaryStore.status)}</Text>
            <Text style={styles.bannerSub}>
              {primaryStore.status === 'pending_approval'
                ? 'Cuando un admin apruebe tu local vas a empezar a recibir pedidos.'
                : 'Tu local no está recibiendo pedidos en este momento.'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Fila fija (sin ScrollView horizontal): evita el hueco vertical típico de RN. */}
      <View style={styles.tabRow}>
        {FILTER_TABS.map((tab) => {
          const active = filter === tab.id;
          const count = countsByFilter[tab.id];
          return (
            <Pressable
              key={tab.id}
              onPress={() => {
                setFilter(tab.id);
                setHighlightId(null);
              }}
              style={({ pressed }) => [
                styles.tabBtn,
                active ? styles.tabBtnActive : null,
                pressed && styles.cardPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
            >
              <Text
                style={[styles.tabBtnText, active ? styles.tabBtnTextActive : null]}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {tab.label}
              </Text>
              {count > 0 ? (
                <View style={[styles.tabBadge, active ? styles.tabBadgeActive : null]}>
                  <Text style={styles.tabBadgeText}>{count > 99 ? '99+' : String(count)}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar código de orden"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          style={styles.searchInput}
          accessibilityLabel="Buscar código de orden"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Limpiar búsqueda">
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {loading && cards.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Cargando pedidos…</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View style={styles.centered}>
          <Text style={styles.warn}>{error}</Text>
          <AppButton title="Reintentar" onPress={refresh} variant="secondary" />
        </View>
      ) : null}

      {!error && searchMiss && normalizeOrderCodeInput(query) ? (
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={36} color={colors.textSecondary} />
          <Text style={styles.warn}>No encontramos el código {normalizeOrderCodeInput(query)}.</Text>
          <Text style={styles.muted}>Revisá el número o pedile al cliente que confirme el código.</Text>
        </View>
      ) : null}

      {!error && !(searchMiss && normalizeOrderCodeInput(query)) ? (
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(item) => item.targetId}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
          }
          onScrollToIndexFailed={() => undefined}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={40} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>
                Sin pedidos en{' '}
                {FILTER_TABS.find((t) => t.id === filter)?.label ?? 'esta lista'}
              </Text>
              <Text style={styles.muted}>{EMPTY_HINT[filter]}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <KanbanCard
              card={item}
              pin={pinByCard[item.targetId] ?? ''}
              closing={closingId === item.targetId}
              expanded={item.column === 'rechazadas' || expandedId === item.targetId}
              highlighted={highlightId === item.targetId}
              onChangePin={(pin) =>
                setPinByCard((prev) => ({ ...prev, [item.targetId]: pin }))
              }
              onPress={() => onOpenCard(item)}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === item.targetId ? null : item.targetId))
              }
              onClose={() => void onCloseOrder(item)}
            />
          )}
        />
      ) : null}
    </View>
  );
}

function formatBoardDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startToday.getTime() - startThat.getTime()) / 86_400_000);
  if (dayDiff === 0) {
    return `Hoy ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (dayDiff === 1) return 'Ayer';
  if (dayDiff > 1 && dayDiff < 7) return `Hace ${dayDiff} días`;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function itemsSummary(card: StoreBoardCard): string | null {
  const total = card.itemCount || card.acceptedItems.length + card.rejectedItems.length;
  if (card.acceptedItems.length > 0 && total > 0) {
    return `${card.acceptedItems.length} de ${total} ítem${total === 1 ? '' : 's'} aceptado${
      card.acceptedItems.length === 1 ? '' : 's'
    }`;
  }
  if (card.rejectedItems.length > 0 && card.acceptedItems.length === 0 && total > 0) {
    return `${card.rejectedItems.length} de ${total} ítem${total === 1 ? '' : 's'} rechazado${
      card.rejectedItems.length === 1 ? '' : 's'
    }`;
  }
  if (total > 0) {
    return `${total} ítem${total === 1 ? '' : 's'}`;
  }
  return null;
}

function KanbanCard({
  card,
  pin,
  closing,
  expanded,
  highlighted,
  onChangePin,
  onPress,
  onToggleExpand,
  onClose,
}: {
  card: StoreBoardCard;
  pin: string;
  closing: boolean;
  expanded: boolean;
  highlighted: boolean;
  onChangePin: (pin: string) => void;
  onPress: () => void;
  onToggleExpand: () => void;
  onClose: () => void;
}) {
  const showCode =
    (card.column === 'confirmadas' || card.column === 'cerradas') && Boolean(card.orderCode);

  const headline = showCode
    ? card.orderCode!
    : card.clientFirstName
      ? card.clientFirstName
      : 'Pedido';

  const priceLabel =
    card.finalAmount != null && card.finalAmount > 0
      ? formatMoneyAr(card.finalAmount)
      : card.amountDueToStore != null && card.amountDueToStore > 0
        ? formatMoneyAr(card.amountDueToStore)
        : card.totalAmount != null && card.totalAmount > 0
          ? formatMoneyAr(card.totalAmount)
          : null;

  const dateLabel = formatBoardDate(card.quotedAt ?? card.createdAt);
  const summary = itemsSummary(card);
  const rejectedForDisplay = card.rejectedItems;
  const canExpandDetails =
    card.column !== 'rechazadas' &&
    (card.acceptedItems.length > 0 || card.rejectedItems.length > 0);
  const showRejectedAlways = card.column === 'rechazadas';
  /** Nombre abajo solo si el headline es el código de orden (evita duplicar). */
  const showClientUnderCode = showCode && Boolean(card.clientFirstName);

  return (
    <View style={[styles.card, highlighted ? styles.cardHighlight : null]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && styles.cardPressed]}
        accessibilityRole="button"
        accessibilityLabel={headline}
      >
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardCode} numberOfLines={1}>
            {headline}
          </Text>
          {dateLabel ? (
            <Text style={styles.cardDate} numberOfLines={1}>
              {dateLabel}
            </Text>
          ) : null}
        </View>
        {showClientUnderCode ? (
          <Text style={styles.cardClient}>{card.clientFirstName}</Text>
        ) : null}
        {summary ? <Text style={styles.cardMeta}>{summary}</Text> : null}
        {priceLabel && card.column !== 'cotizadas' && card.column !== 'rechazadas' ? (
          <Text style={styles.cardPrice}>
            {card.column === 'nuevas' || card.column === 'cerradas' ? 'Total' : 'A cobrar'}{' '}
            {priceLabel}
          </Text>
        ) : null}

        {card.column === 'nuevas' ? (
          <Text style={styles.cardAction}>Cotizar</Text>
        ) : (
          <Text style={styles.cardAction}>Ver cotización</Text>
        )}
      </Pressable>

      {canExpandDetails ? (
        <Pressable
          onPress={onToggleExpand}
          hitSlop={6}
          style={styles.expandBtn}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Ocultar ítems' : 'Ver ítems'}
        >
          <Text style={styles.expandBtnText}>
            {expanded ? 'Ocultar ítems' : 'Ver ítems aceptados / rechazados'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.primary}
          />
        </Pressable>
      ) : null}

      {expanded && canExpandDetails ? (
        <View style={styles.decisionsBox}>
          {card.acceptedItems.length > 0 ? (
            <View style={styles.decisionBlock}>
              <Text style={styles.decisionTitleOk}>Aceptados</Text>
              {card.acceptedItems.map((it) => (
                <Text key={`a-${it.requestItemId}`} style={styles.decisionLine} numberOfLines={2}>
                  · {it.description}
                </Text>
              ))}
            </View>
          ) : null}
          {card.rejectedItems.length > 0 ? (
            <View style={styles.decisionBlock}>
              <Text style={styles.decisionTitleNo}>Rechazados</Text>
              {card.rejectedItems.map((it) => (
                <Text
                  key={`r-${it.requestItemId}`}
                  style={styles.decisionLineMuted}
                  numberOfLines={2}
                >
                  · {it.description}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {showRejectedAlways ? (
        <View style={styles.decisionsBox}>
          <View style={styles.decisionBlock}>
            <Text style={styles.decisionTitleNo}>Ítems rechazados</Text>
            {rejectedForDisplay.length > 0 ? (
              rejectedForDisplay.map((it) => (
                <Text
                  key={`rj-${it.requestItemId}`}
                  style={styles.decisionLineMuted}
                  numberOfLines={3}
                >
                  · {it.description}
                </Text>
              ))
            ) : (
              <Text style={styles.decisionLineMuted}>Cotización rechazada por completo.</Text>
            )}
          </View>
        </View>
      ) : null}

      {card.column === 'confirmadas' ? (
        <View style={styles.closeBox}>
          <Text style={styles.closeLabel}>PIN del cliente</Text>
          <TextInput
            value={pin}
            onChangeText={(t) => onChangePin(t.replace(/\D/g, '').slice(0, 4))}
            placeholder="••••"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            style={styles.pinInput}
          />
          <Pressable
            onPress={onClose}
            disabled={closing}
            style={({ pressed }) => [
              styles.closeBtn,
              closing && styles.closeBtnDisabled,
              pressed && !closing && styles.cardPressed,
            ]}
          >
            <Text style={styles.closeBtnText}>{closing ? 'Cerrando…' : 'Confirmar retiro'}</Text>
          </Pressable>
        </View>
      ) : null}

      {card.column === 'cerradas' ? (
        <Text style={styles.doneLabel}>Entrega confirmada</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: '#FFF8E1',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  bannerSub: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  tabRow: {
    flexDirection: 'row',
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'stretch',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: 2,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabBtnActive: {
    borderColor: colors.primary,
    backgroundColor: '#FDECEA',
  },
  tabBtnText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tabBtnTextActive: { color: colors.primary },
  tabBadge: {
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 0,
    borderRadius: 8,
    backgroundColor: colors.border,
    alignItems: 'center',
  },
  tabBadgeActive: { backgroundColor: colors.primary },
  tabBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    padding: 0,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  emptyWrap: {
    flexGrow: 1,
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
  },
  cardHighlight: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: '#FFF5F4',
  },
  cardPressed: { opacity: 0.9 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardCode: {
    flex: 1,
    minWidth: 0,
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 0.2,
  },
  cardDate: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cardClient: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  cardPrice: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  cardBadgeMuted: {
    alignSelf: 'flex-start',
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  expandBtn: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  expandBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  decisionsBox: {
    marginTop: 4,
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  decisionBlock: { gap: 2 },
  decisionTitleOk: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1B5E20',
  },
  decisionTitleNo: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  decisionLine: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 16,
  },
  decisionLineMuted: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
    textDecorationLine: 'line-through',
  },
  cardAction: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  closeBox: {
    marginTop: spacing.sm,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  closeLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  pinInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 4,
  },
  closeBtn: {
    marginTop: 2,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 11,
    alignItems: 'center',
  },
  closeBtnDisabled: { opacity: 0.55 },
  closeBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  doneLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#1B5E20',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  muted: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  warn: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
  },
});
