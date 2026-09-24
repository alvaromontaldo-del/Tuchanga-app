import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components/common/AppButton';
import { useAppToast } from '../../components/toast/toast';
import { colors, radii, spacing } from '../../constants/theme';
import { listKey } from '../../utils/safeAsync';
import {
  useAcceptClientQuote,
  useClientCompareQuotes,
} from '../../hooks/useClientQuotes';
import { formatMoneyAr } from '../../services/clientQuotesSupabase';
import { quoteFreightDisplay } from '../../utils/quoteFreightTotal';
import { formatOrderCodeDisplay } from '../../utils/orderCode';
import { normalizeDisplayAddress } from '../../utils/formatAddress';
import {
  defaultIncludeFreight,
  defaultSelectedItemIds,
  groupQuoteItemsByRequest,
  isClientSelectableQuoteItem,
  pickBestQuoteId,
} from '../../utils/pickBestQuote';
import type { ClientQuoteCard } from '../../types/materials';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type LegacyClientQuotesParamList = {
  ClientMaterialQuotesList: undefined;
  ClientCompareQuotes: { requestId: string; readOnly?: boolean };
  MaterialOrderSummary: {
    requestId: string;
    selections: {
      quoteId: string;
      storeLabel: string;
      itemIds: string[];
      items: { id: string; description: string; lineTotal: number }[];
      includeFreight: boolean;
      freightCost: number;
      materialsSubtotal: number;
    }[];
  };
  MaterialOrderDetail: { orderId: string };
};

type Props = NativeStackScreenProps<LegacyClientQuotesParamList, 'ClientCompareQuotes'>;

type Section = {
  title: string;
  rubroId: string;
  data: ClientQuoteCard[];
};

/**
 * Comparación de presupuestos por rubro — "Cotizaciones para mi Obra".
 */
export function ClientCompareQuotesScreen({ navigation, route }: Props) {
  const { requestId } = route.params;
  const readOnly = Boolean(route.params.readOnly);
  const toast = useAppToast();
  const { requestTitle, requestStatus, groups, loading, error, refresh } =
    useClientCompareQuotes(requestId);
  const { reject, accepting } = useAcceptClientQuote();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  /** Ítems seleccionados por quoteId */
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<string>>>({});
  /** Flete opcional por quoteId (solo si freight_cost > 0) */
  const [includeFreight, setIncludeFreight] = useState<Record<string, boolean>>({});

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const sections: Section[] = useMemo(
    () =>
      groups.map((g) => ({
        title: g.rubroName,
        rubroId: g.rubroId,
        data: g.quotes,
      })),
    [groups],
  );

  /** quoteId de la mejor propuesta por rubro (más barata; empate → más cerca). */
  const bestQuoteIdByRubro = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      const bestId = pickBestQuoteId(g.quotes);
      if (bestId) map.set(g.rubroId, bestId);
    }
    return map;
  }, [groups]);

  const selectionInitRef = useRef<string | null>(null);

  useEffect(() => {
    selectionInitRef.current = null;
    setSelectedItems({});
    setIncludeFreight({});
  }, [requestId]);

  useEffect(() => {
    if (readOnly || groups.length === 0) return;
    const signature = groups
      .map((g) => `${g.rubroId}:${pickBestQuoteId(g.quotes) ?? '-'}`)
      .join('|');
    const initKey = `${requestId}:${signature}`;
    if (selectionInitRef.current === initKey) return;
    selectionInitRef.current = initKey;

    const nextSelected: Record<string, Set<string>> = {};
    const nextFreight: Record<string, boolean> = {};
    for (const g of groups) {
      const bestId = bestQuoteIdByRubro.get(g.rubroId);
      if (!bestId) continue;
      const card = g.quotes.find((q) => q.quoteId === bestId);
      if (!card) continue;
      nextSelected[bestId] = defaultSelectedItemIds(card);
      nextFreight[bestId] = defaultIncludeFreight(card);
    }
    setSelectedItems(nextSelected);
    setIncludeFreight(nextFreight);
  }, [bestQuoteIdByRubro, groups, readOnly, requestId]);

  /** quoteId del más cercano por sección (solo uno por rubro). */
  const closestQuoteIdByRubro = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      let bestId: string | null = null;
      let bestKm = Number.POSITIVE_INFINITY;
      for (const q of g.quotes) {
        if (q.distanceKm == null || !Number.isFinite(q.distanceKm)) continue;
        if (q.distanceKm < bestKm) {
          bestKm = q.distanceKm;
          bestId = q.quoteId;
        }
      }
      if (bestId) map.set(g.rubroId, bestId);
    }
    return map;
  }, [groups]);

  const requestCompleted = requestStatus === 'completed';
  const isClientView = !readOnly;
  const hasAnyFeePaid = useMemo(
    () =>
      groups.some((g) =>
        g.quotes.some(
          (q) =>
            q.status === 'accepted' ||
            q.contactRevealed ||
            q.orderStatus === 'deposit_paid' ||
            q.orderStatus === 'completed',
        ),
      ),
    [groups],
  );
  const hasAnyPendingFee = useMemo(
    () =>
      groups.some((g) =>
        g.quotes.some(
          (q) =>
            q.orderId != null &&
            (q.orderStatus === 'pending_deposit' || q.orderStatus === 'pending') &&
            !q.contactRevealed,
        ),
      ),
    [groups],
  );

  const toggleExpand = useCallback((quoteId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === quoteId ? null : quoteId));
  }, []);

  const toggleItem = useCallback((quoteId: string, quoteItemId: string, requestItemId: string) => {
    setSelectedItems((prev) => {
      const card = selectableQuotes.find((q) => q.quoteId === quoteId);
      const current = new Set(prev[quoteId] ?? []);
      if (current.has(quoteItemId)) {
        current.delete(quoteItemId);
      } else {
        // Una sola variante por ítem pedido.
        if (card) {
          for (const it of card.items) {
            if (it.requestItemId === requestItemId) current.delete(it.quoteItemId);
          }
        }
        current.add(quoteItemId);
      }
      return { ...prev, [quoteId]: current };
    });
  }, [selectableQuotes]);

  const ensureDefaults = useCallback(
    (card: ClientQuoteCard, rubroId: string) => {
      const isBest = bestQuoteIdByRubro.get(rubroId) === card.quoteId;
      setSelectedItems((prev) => {
        if (prev[card.quoteId]) return prev;
        return {
          ...prev,
          [card.quoteId]: isBest ? defaultSelectedItemIds(card) : new Set<string>(),
        };
      });
      setIncludeFreight((prev) => {
        if (prev[card.quoteId] != null) return prev;
        return {
          ...prev,
          [card.quoteId]: isBest ? defaultIncludeFreight(card) : false,
        };
      });
    },
    [bestQuoteIdByRubro],
  );

  const selectableQuotes = useMemo(() => {
    return groups.flatMap((g) =>
      g.quotes.filter(
        (q) =>
          q.status === 'sent' &&
          !q.contactRevealed &&
          !(
            q.orderId &&
            (q.orderStatus === 'pending_deposit' || q.orderStatus === 'pending')
          ),
      ),
    );
  }, [groups]);

  const cartPreview = useMemo(() => {
    let materials = 0;
    let stores = 0;
    for (const card of selectableQuotes) {
      const ids = selectedItems[card.quoteId];
      if (!ids || ids.size === 0) continue;
      const lines = card.items.filter(
        (it) => ids.has(it.quoteItemId) && isClientSelectableQuoteItem(it),
      );
      if (lines.length === 0) continue;
      stores += 1;
      materials += lines.reduce((a, it) => a + it.lineTotal, 0);
      const freightOn =
        includeFreight[card.quoteId] === true &&
        card.freightType === 'cost' &&
        card.freightCost > 0;
      if (freightOn) materials += card.freightCost;
    }
    return { materials, stores };
  }, [selectableQuotes, selectedItems, includeFreight]);

  const goToSummary = useCallback(() => {
    if (readOnly || requestCompleted) return;
    const selections: LegacyClientQuotesParamList['MaterialOrderSummary']['selections'] = [];
    let freightOnlyAttempt = false;

    for (const card of selectableQuotes) {
      ensureDefaults(card, card.groupRubroId);
      const ids = Array.from(selectedItems[card.quoteId] ?? []);
      const hasFreight =
        card.freightType === 'cost' &&
        card.freightCost > 0 &&
        includeFreight[card.quoteId] === true;
      if (ids.length < 1) {
        if (hasFreight) freightOnlyAttempt = true;
        continue;
      }
      const items = card.items
        .filter((it) => ids.includes(it.quoteItemId) && isClientSelectableQuoteItem(it))
        .map((it) => ({
          id: it.requestItemId,
          quoteItemId: it.quoteItemId,
          description: it.variantLabel
            ? `${it.description} (${it.variantLabel})`
            : it.description,
          lineTotal: it.lineTotal,
        }));
      if (items.length < 1) continue;
      const materialsSubtotal = items.reduce((a, it) => a + it.lineTotal, 0);
      const freightQuoted = card.freightType === 'cost' && card.freightCost > 0;
      selections.push({
        quoteId: card.quoteId,
        storeLabel: card.contactRevealed
          ? card.storeName
          : `${card.groupRubroName || 'Comercio'} · oferta`,
        itemIds: items.map((it) => it.id),
        quoteItemIds: items.map((it) => it.quoteItemId),
        items,
        includeFreight: freightQuoted ? includeFreight[card.quoteId] === true : false,
        freightCost: freightQuoted ? card.freightCost : 0,
        materialsSubtotal,
      });
    }

    if (selections.length < 1) {
      toast.warning(
        freightOnlyAttempt
          ? 'No podés confirmar solo el flete. Seleccioná al menos un material.'
          : 'Seleccioná al menos un ítem de material.',
        'Ítems',
      );
      return;
    }

    (navigation as any).navigate('MaterialOrderSummary', {
      requestId,
      selections,
    });
  }, [
    ensureDefaults,
    includeFreight,
    navigation,
    readOnly,
    requestCompleted,
    requestId,
    selectableQuotes,
    selectedItems,
    toast,
  ]);

  const handlePendingPay = useCallback(
    (card: ClientQuoteCard) => {
      if (card.orderId) {
        (navigation as any).navigate('MaterialOrderDetail', { orderId: card.orderId });
      }
    },
    [navigation],
  );

  const handleReject = useCallback(
    (card: ClientQuoteCard) => {
      if (readOnly) return;
      if (card.status !== 'sent') return;
      Alert.alert('Rechazar cotización', `¿Rechazás el presupuesto de ${card.storeName}?`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Rechazar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setAcceptingId(card.quoteId);
              try {
                await reject(card.quoteId);
                toast.success('Cotización rechazada.', 'Listo');
                refresh();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'No se pudo rechazar.', 'Error');
              } finally {
                setAcceptingId(null);
              }
            })();
          },
        },
      ]);
    },
    [readOnly, reject, refresh, toast],
  );

  if (loading && sections.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Cargando cotizaciones…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.warn}>{error}</Text>
        <AppButton title="Reintentar" onPress={refresh} variant="secondary" />
        <AppButton title="Volver" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => listKey(item?.quoteId, index, 'cotizacion')}
        stickySectionHeadersEnabled
        contentContainerStyle={[
          styles.list,
          !readOnly && cartPreview.stores > 0 ? { paddingBottom: 120 } : null,
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.obraTitle} numberOfLines={2}>
              {requestTitle || 'Mi obra'}
            </Text>
            <Text style={styles.lead}>
              {readOnly
                ? 'Vista de las cotizaciones. Los datos del comercio se revelan al cliente cuando paga el costo de servicio YaChanga.'
                : 'Elegí ítems de uno o varios comercios (y el flete si aplica). Vas a un resumen con un solo pago del costo de servicio YaChanga.'}
            </Text>
            {isClientView && hasAnyPendingFee ? (
              <Text style={styles.acceptedBanner}>
                Tenés órdenes con costo de servicio pendiente. Pagalo para confirmar la
                cotización y ver los datos del comercio.
              </Text>
            ) : null}
            {isClientView && hasAnyFeePaid ? (
              <Text style={styles.acceptedBanner}>
                Ya confirmaste al menos una cotización (fee pagado). Podés seguir con otros
                comercios.
              </Text>
            ) : null}
            {requestCompleted ? (
              <Text style={styles.acceptedBanner}>Este pedido está cerrado.</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={40} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>Sin presupuestos todavía</Text>
            <Text style={styles.muted}>
              Cuando los comercios respondan, vas a poder compararlos acá.
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>
              {section.data.length} oferta{section.data.length === 1 ? '' : 's'}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <QuoteCard
            card={item}
            readOnly={readOnly}
            isBest={bestQuoteIdByRubro.get(section.rubroId) === item.quoteId}
            isClosest={closestQuoteIdByRubro.get(section.rubroId) === item.quoteId}
            expanded={expandedId === item.quoteId}
            onToggleDetail={() => {
              ensureDefaults(item, section.rubroId);
              toggleExpand(item.quoteId);
            }}
            selectedItemIds={
              selectedItems[item.quoteId] ??
              (bestQuoteIdByRubro.get(section.rubroId) === item.quoteId
                ? defaultSelectedItemIds(item)
                : new Set<string>())
            }
            includeFreight={
              includeFreight[item.quoteId] ??
              (bestQuoteIdByRubro.get(section.rubroId) === item.quoteId
                ? defaultIncludeFreight(item)
                : false)
            }
            onToggleFreight={() => {
              if (readOnly) return;
              ensureDefaults(item, section.rubroId);
              setIncludeFreight((prev) => ({
                ...prev,
                [item.quoteId]: !(prev[item.quoteId] ?? false),
              }));
            }}
            onToggleItem={(quoteItemId, requestItemId) => {
              if (readOnly) return;
              ensureDefaults(item, section.rubroId);
              toggleItem(item.quoteId, quoteItemId, requestItemId);
            }}
            onPayPending={() => handlePendingPay(item)}
            onOpenOrder={() => {
              if (item.orderId) {
                (navigation as any).navigate('MaterialOrderDetail', { orderId: item.orderId });
              }
            }}
            onReject={() => handleReject(item)}
            accepting={accepting && acceptingId === item.quoteId}
            disabledActions={
              readOnly ||
              requestCompleted ||
              item.status === 'rejected' ||
              item.status === 'accepted' ||
              item.contactRevealed ||
              accepting
            }
          />
        )}
      />
      {!readOnly && !requestCompleted && cartPreview.stores > 0 ? (
        <View style={styles.cartBar}>
          <Text style={styles.cartMeta}>
            {cartPreview.stores} comercio{cartPreview.stores === 1 ? '' : 's'}
          </Text>
          <Pressable
            onPress={goToSummary}
            style={({ pressed }) => [styles.cartBtn, pressed && styles.acceptBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Ir al resumen de pedido"
          >
            <Text style={styles.acceptBtnText}>Continuar al resumen</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const QuoteCard = memo(function QuoteCard({
  card,
  readOnly,
  isBest,
  isClosest,
  expanded,
  onToggleDetail,
  onPayPending,
  onOpenOrder,
  onReject,
  accepting,
  disabledActions,
  selectedItemIds,
  onToggleItem,
  includeFreight,
  onToggleFreight,
}: {
  card: ClientQuoteCard;
  readOnly: boolean;
  isBest: boolean;
  isClosest: boolean;
  expanded: boolean;
  onToggleDetail: () => void;
  onPayPending: () => void;
  onOpenOrder: () => void;
  onReject: () => void;
  accepting: boolean;
  disabledActions: boolean;
  selectedItemIds: Set<string>;
  onToggleItem: (quoteItemId: string, requestItemId: string) => void;
  includeFreight: boolean;
  onToggleFreight: () => void;
}) {
  const distanceText =
    card.contactRevealed && card.distanceKm != null
      ? `A ${card.distanceKm.toLocaleString('es-AR', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} km de tu casa`
      : null;

  const rubroLine =
    card.rubroNames.length > 0 ? card.rubroNames.join(' · ') : card.groupRubroName;

  const isFeePaid =
    card.status === 'accepted' ||
    card.contactRevealed ||
    card.orderStatus === 'deposit_paid' ||
    card.orderStatus === 'completed';
  const isRejected = card.status === 'rejected';
  const awaitsFeePayment =
    !isFeePaid &&
    !isRejected &&
    Boolean(card.orderId) &&
    (card.orderStatus === 'pending_deposit' || card.orderStatus === 'pending');
  const canSelectItems = !readOnly && card.status === 'sent' && !awaitsFeePayment && !isFeePaid;
  const showFreightToggle =
    canSelectItems && card.freightType === 'cost' && card.freightCost > 0;

  const allItemsInStock =
    card.items.length > 0 &&
    card.items.every((it) => it.inStock && Number.isFinite(it.unitPrice) && it.unitPrice >= 0);
  const hasFreight =
    card.freightType === 'free' || (card.freightType === 'cost' && card.freightCost > 0);
  const freightDisplay = quoteFreightDisplay({
    materialsSubtotal: card.materialsSubtotal,
    freightType: card.freightType,
    quotedFreightCost: card.freightCost,
    orderIncludeFreight: card.orderIncludeFreight,
    uiIncludeFreight: includeFreight,
    canChooseFreight: showFreightToggle,
  });

  return (
    <View style={[styles.card, isBest && styles.cardBest, isFeePaid && styles.cardAccepted]}>
      {isBest ? (
        <Text style={styles.bestBadge}>Menor total en este rubro</Text>
      ) : null}
      {isFeePaid ? (
        <Text style={styles.acceptedBadge}>Costo de servicio pago</Text>
      ) : null}
      {isRejected ? <Text style={styles.rejectedBadge}>Rechazada</Text> : null}

      <View style={styles.featureBadges}>
        {allItemsInStock ? (
          <Text style={styles.featureBadge}>Todos los items en stock</Text>
        ) : null}
        {hasFreight ? <Text style={styles.featureBadge}>Con flete</Text> : null}
        {isClosest ? <Text style={styles.featureBadge}>El más cerca</Text> : null}
      </View>

      {!card.contactRevealed ? (
        <>
          <Text style={styles.storeName} numberOfLines={2}>
            {card.storeName}
          </Text>
          <Text style={styles.rubroLine} numberOfLines={1}>
            {rubroLine}
          </Text>
          {!readOnly ? (
            <Text style={styles.hiddenHint}>
              {awaitsFeePayment
                ? 'Selección guardada. Pagá el costo de servicio YaChanga para confirmar y ver el comercio.'
                : 'Identidad del comercio oculta hasta pagar el costo de servicio'}
            </Text>
          ) : (
            <Text style={styles.rubroLine}>
              Los datos del comercio se revelan al cliente al pagar el costo de servicio.
            </Text>
          )}
        </>
      ) : (
        <View style={styles.contactBlock}>
          <Text style={styles.revealedLabel}>Comercio revelado</Text>
          <Text style={styles.storeName} numberOfLines={2}>
            {(card.storeName ?? '').trim() || 'Comercio'}
          </Text>
          <Text style={styles.rubroLine} numberOfLines={1}>
            {rubroLine}
          </Text>
          <Text style={styles.addressLine} numberOfLines={4}>
            Dir:{' '}
            {card.storeAddress.trim()
              ? normalizeDisplayAddress(card.storeAddress.trim())
              : 'No informada — contactá al comercio'}
          </Text>
          {!readOnly && (card.orderCode || card.verificationPin) ? (
            <View style={styles.pinBox}>
              {card.orderCode ? (
                <Text style={styles.pinLine}>
                  Código de orden:{' '}
                  <Text style={styles.pinValue}>{formatOrderCodeDisplay(card.orderCode)}</Text>
                </Text>
              ) : null}
              {card.verificationPin ? (
                <Text style={styles.pinLine}>
                  PIN (dáselo al comercio):{' '}
                  <Text style={styles.pinValue}>{card.verificationPin.padStart(4, '0')}</Text>
                </Text>
              ) : null}
            </View>
          ) : null}
          {!readOnly && card.orderId ? (
            <Pressable onPress={onOpenOrder} style={styles.orderLink}>
              <Text style={styles.orderLinkText}>Ver código y PIN</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {distanceText ? (
        <View style={styles.distanceRow}>
          <Text style={styles.distancePin}>📍</Text>
          <Text style={styles.distanceText}>{distanceText}</Text>
        </View>
      ) : null}

      <View style={styles.totalsBox}>
        <RowLine label="Materiales" value={formatMoneyAr(card.materialsSubtotal)} />
        <RowLine
          label={freightDisplay.freightRowLabel}
          value={formatMoneyAr(freightDisplay.freightAmount)}
        />
        <View style={styles.totalDivider} />
        <RowLine label="TOTAL" value={formatMoneyAr(freightDisplay.total)} strong />
      </View>

      {showFreightToggle ? (
        <Pressable
          onPress={onToggleFreight}
          style={styles.freightToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: includeFreight }}
        >
          <Ionicons
            name={includeFreight ? 'checkbox' : 'square-outline'}
            size={22}
            color={includeFreight ? colors.primary : colors.textSecondary}
          />
          <Text style={styles.freightToggleText}>
            Incluir flete (si no, retiro en local)
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onToggleDetail}
        style={({ pressed }) => [styles.detailBtn, pressed && { opacity: 0.75 }]}
        accessibilityRole="button"
        accessibilityLabel="Ver detalle de ítems"
      >
        <Text style={styles.detailBtnText}>
          {expanded
            ? 'Ocultar detalle de ítems'
            : readOnly
              ? 'Ver detalle de ítems'
              : 'Ver Detalle / elegir ítems'}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.primary}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.detailPanel}>
          {groupQuoteItemsByRequest(card.items).map((group) => {
            const variants = group.variants;
            const multi = variants.length > 1;
            return (
              <View key={group.requestItemId} style={styles.detailGroup}>
                {multi ? (
                  <Text style={styles.detailDesc} numberOfLines={3}>
                    {group.description}
                  </Text>
                ) : null}
                {variants.map((it) => {
                  const selected = selectedItemIds.has(it.quoteItemId);
                  const decided =
                    it.clientDecision === 'accepted' || it.clientDecision === 'rejected';
                  const itemSelectable = canSelectItems && isClientSelectableQuoteItem(it);
                  const label =
                    it.variantLabel?.trim() ||
                    (!it.inStock ? it.alternativeDescription?.trim() : '') ||
                    (multi ? `Opción ${it.variantIndex}` : it.description);
                  return (
                    <Pressable
                      key={it.quoteItemId}
                      onPress={() => {
                        if (itemSelectable) onToggleItem(it.quoteItemId, it.requestItemId);
                      }}
                      style={[
                        styles.detailRow,
                        canSelectItems && !itemSelectable && styles.detailRowDisabled,
                      ]}
                      disabled={!itemSelectable}
                    >
                      {canSelectItems ? (
                        <Ionicons
                          name={
                            !itemSelectable
                              ? 'close-circle-outline'
                              : multi
                                ? selected
                                  ? 'radio-button-on'
                                  : 'radio-button-off'
                                : selected
                                  ? 'checkbox'
                                  : 'square-outline'
                          }
                          size={22}
                          color={
                            !itemSelectable
                              ? colors.textSecondary
                              : selected
                                ? colors.primary
                                : colors.textSecondary
                          }
                          style={{ marginRight: 8 }}
                        />
                      ) : decided ? (
                        <Ionicons
                          name={
                            it.clientDecision === 'accepted'
                              ? 'checkmark-circle'
                              : 'close-circle'
                          }
                          size={22}
                          color={
                            it.clientDecision === 'accepted' ? '#2E7D32' : colors.error
                          }
                          style={{ marginRight: 8 }}
                        />
                      ) : null}
                      <View style={styles.detailLeft}>
                        <Text style={styles.detailDesc} numberOfLines={3}>
                          {label}
                        </Text>
                        {it.clientDecision === 'accepted' ? (
                          <Text style={[styles.detailAltBadge, styles.detailStockOk]}>
                            Aceptado
                          </Text>
                        ) : it.clientDecision === 'rejected' ? (
                          <Text style={styles.detailAltBadge}>Rechazado</Text>
                        ) : null}
                        <Text
                          style={[
                            styles.detailAltBadge,
                            it.inStock && styles.detailStockOk,
                          ]}
                        >
                          {it.inStock ? 'Con stock' : 'Sin stock'}
                        </Text>
                        {!it.inStock &&
                        !it.alternativeDescription?.trim() &&
                        !it.variantLabel?.trim() ? (
                          <Text style={styles.detailAlt} numberOfLines={2}>
                            Sin alternativa — no se puede seleccionar
                          </Text>
                        ) : null}
                        {it.itemNote ? (
                          <Text style={styles.detailItemNote} numberOfLines={2}>
                            {it.itemNote}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.detailLineTotal}>
                        {formatMoneyAr(it.lineTotal)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
          {card.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>Notas / Reemplazos</Text>
              <Text style={styles.notesBody}>{card.notes}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {!readOnly && !isFeePaid && !isRejected ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={onReject}
            disabled={disabledActions || accepting || awaitsFeePayment}
            style={({ pressed }) => [
              styles.rejectBtn,
              (disabledActions || accepting || awaitsFeePayment) && styles.acceptBtnDisabled,
              pressed && !disabledActions && !accepting && styles.acceptBtnPressed,
            ]}
          >
            <Text style={styles.rejectBtnText}>Rechazar toda</Text>
          </Pressable>
          {awaitsFeePayment ? (
            <Pressable
              onPress={onPayPending}
              disabled={accepting}
              style={({ pressed }) => [
                styles.acceptBtn,
                accepting && styles.acceptBtnDisabled,
                pressed && !accepting && styles.acceptBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Pagar costo de servicio"
            >
              {accepting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.acceptBtnText}>Pagar costo de servicio</Text>
              )}
            </Pressable>
          ) : (
            <View style={styles.acceptBtnHint}>
              <Text style={styles.acceptBtnHintText}>
                Marcá ítems y usá Continuar al resumen
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
});

function RowLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.rowLine}>
      <Text style={[styles.rowLabel, strong && styles.rowLabelStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { marginBottom: spacing.md, gap: 8 },
  obraTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  lead: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  acceptedBanner: {
    marginTop: 4,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: '#E8F5E9',
    color: '#1B5E20',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: 2,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cardBest: {
    borderColor: colors.primary,
    backgroundColor: '#FFF8F8',
  },
  cardAccepted: {
    borderColor: '#2E7D32',
    backgroundColor: '#F1F8F2',
  },
  bestBadge: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    backgroundColor: '#FDECEA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  acceptedBadge: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '800',
    color: '#1B5E20',
    backgroundColor: '#C8E6C9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  rejectedBadge: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '800',
    color: colors.error,
    backgroundColor: '#FDECEA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  featureBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  featureBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  storeName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  rubroLine: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  hiddenHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    overflow: 'hidden',
  },
  addressLine: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  pinBox: {
    marginTop: 10,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    gap: 6,
  },
  pinLine: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  pinValue: {
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 1,
  },
  orderLink: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  orderLinkText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  contactBlock: {
    marginTop: 8,
    gap: 4,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: '#E8F5E9',
  },
  revealedLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1B5E20',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    marginBottom: 12,
  },
  distancePin: { fontSize: 14 },
  distanceText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  totalsBox: {
    backgroundColor: colors.background,
    borderRadius: radii.input,
    padding: spacing.md,
    gap: 6,
  },
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  rowLabelStrong: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  rowValueStrong: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  totalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  detailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: 10,
  },
  detailBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  detailPanel: {
    marginTop: 4,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 10,
  },
  detailGroup: { gap: 8 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailRowDisabled: {
    opacity: 0.55,
  },
  detailLeft: { flex: 1, gap: 2 },
  detailDesc: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  detailAltBadge: {
    marginTop: 2,
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
  detailStockOk: {
    color: '#2E7D32',
  },
  detailAlt: {
    marginTop: 2,
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  detailItemNote: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  detailQty: {
    fontSize: 12,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  detailLineTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  notesBox: {
    marginTop: 4,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: '#FFF8E1',
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  notesBody: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rejectBtn: {
    flex: 0.45,
    borderRadius: radii.button,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rejectBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  acceptBtnPressed: { opacity: 0.9 },
  acceptBtnDisabled: { opacity: 0.45 },
  acceptBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  acceptBtnHint: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  acceptBtnHintText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  freightToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
    paddingVertical: 6,
  },
  freightToggleText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  cartBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    gap: 8,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cartMeta: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cartBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  warn: { textAlign: 'center', color: colors.textSecondary, fontSize: 15 },
});
