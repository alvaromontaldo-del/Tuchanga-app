import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { useAppToast } from '../../components/toast/toast';
import { colors, radii, spacing } from '../../constants/theme';
import { useStoreRequestDetail } from '../../hooks/useStoreQuotes';
import {
  useSubmitStoreQuote,
  emptyQuoteItemDraft,
  type QuoteItemDraftState,
} from '../../hooks/useSubmitStoreQuote';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import { formatMoneyAr } from '../../services/clientQuotesSupabase';
import { sanitizePriceText } from '../../services/storeQuotesSupabase';
import type {
  ExistingStoreQuoteItem,
  FreightType,
  MaterialRequestItem,
} from '../../types/materials';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

const FREIGHT_OPTIONS: { value: FreightType; label: string }[] = [
  { value: 'pickup', label: 'Retiro en local' },
  { value: 'free', label: 'Flete gratis' },
  { value: 'cost', label: 'Flete con costo' },
];

function freightOptionLabel(type: FreightType): string {
  return FREIGHT_OPTIONS.find((o) => o.value === type)?.label ?? 'Logística';
}

function formatDraftPrice(priceText: string): string {
  const n = Number(String(priceText).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return '—';
  return formatMoneyAr(n);
}

type Props = NativeStackScreenProps<CommerceStackParamList, 'StoreQuoteRequest'>;

type ListRow =
  | { key: string; type: 'header' }
  | { key: string; type: 'item'; item: MaterialRequestItem }
  | { key: string; type: 'logistics' }
  | { key: string; type: 'notes' }
  | { key: string; type: 'footerSpacer' };

const EMPTY_DRAFT: QuoteItemDraftState = emptyQuoteItemDraft();

/**
 * E2: cotización con precios, sin stock + producto alternativo, notas y flete.
 */
export function StoreQuoteRequestScreen({ navigation, route }: Props) {
  const { requestId, storeId } = route.params;
  const toast = useAppToast();
  const { detail, loading, error, refresh } = useStoreRequestDetail({
    requestId,
    storeId,
  });
  const { submit, submitting } = useSubmitStoreQuote();

  const itemDraftsRef = useRef<Record<string, QuoteItemDraftState>>({});
  const freightCostRef = useRef('');
  const notesRef = useRef('');

  const [freightType, setFreightType] = useState<FreightType>('pickup');
  const [freightCostText, setFreightCostText] = useState('');
  /** Fuerza re-render de filas cuando cambia stock (para mostrar campos alternativos). */
  const [draftTick, setDraftTick] = useState(0);
  /** Evita mostrar el formulario vacío antes de hidratar una cotización ya enviada. */
  const [formReady, setFormReady] = useState(false);
  const [notesInitial, setNotesInitial] = useState('');

  useEffect(() => {
    setFormReady(false);
  }, [requestId, storeId]);

  useEffect(() => {
    if (!detail) return;

    const quote = detail.existingQuote;
    if (quote) {
      const drafts: Record<string, QuoteItemDraftState> = {};
      for (const line of quote.items) {
        const prev = drafts[line.requestItemId];
        const variant = {
          label: line.variantLabel ?? line.alternativeDescription ?? '',
          priceText:
            Number.isFinite(line.unitPrice) && line.unitPrice >= 0
              ? String(line.unitPrice)
              : '',
        };
        if (!prev) {
          drafts[line.requestItemId] = {
            inStock: line.inStock,
            variants: [variant],
            itemNote: line.itemNote ?? '',
          };
        } else {
          prev.variants.push(variant);
          if (line.itemNote?.trim()) prev.itemNote = line.itemNote;
          if (!line.inStock) prev.inStock = false;
        }
      }
      itemDraftsRef.current = drafts;
      setFreightType(quote.freightType);
      const costText =
        quote.freightType === 'cost' && Number.isFinite(quote.freightCost)
          ? String(quote.freightCost)
          : '';
      freightCostRef.current = costText;
      setFreightCostText(costText);
      notesRef.current = quote.notes;
      setNotesInitial(quote.notes);
      setDraftTick((n) => n + 1);
    } else {
      itemDraftsRef.current = {};
      freightCostRef.current = '';
      notesRef.current = '';
      setFreightType('pickup');
      setFreightCostText('');
      setNotesInitial('');
    }
    setFormReady(true);
  }, [detail]);

  const listData: ListRow[] = useMemo(() => {
    if (!detail) return [];
    const lockedView = detail.alreadyQuoted;
    const rows: ListRow[] = [{ key: 'header', type: 'header' }];
    for (const item of detail.items) {
      rows.push({ key: `item-${item.id}`, type: 'item', item });
    }
    rows.push({ key: 'logistics', type: 'logistics' });
    const notesText = (detail.existingQuote?.notes ?? notesInitial).trim();
    if (!lockedView || notesText.length > 0) {
      rows.push({ key: 'notes', type: 'notes' });
    }
    rows.push({ key: 'footer', type: 'footerSpacer' });
    return rows;
  }, [detail, notesInitial]);

  const patchItemDraft = useCallback(
    (itemId: string, patch: Partial<QuoteItemDraftState>) => {
      const prev = itemDraftsRef.current[itemId] ?? { ...EMPTY_DRAFT, variants: [{ label: '', priceText: '' }] };
      itemDraftsRef.current[itemId] = { ...prev, ...patch };
      setDraftTick((n) => n + 1);
    },
    [],
  );

  const handleSend = useCallback(async () => {
    if (!detail) return;
    if (detail.alreadyQuoted) {
      toast.warning('Ya enviaste un presupuesto para este pedido.', 'Presupuesto');
      return;
    }

    try {
      await submit({
        requestId: detail.requestId,
        storeId: detail.storeId,
        clientId: detail.clientId,
        freightType,
        freightCostText: freightCostRef.current || freightCostText,
        notes: notesRef.current,
        items: detail.items,
        itemDrafts: { ...itemDraftsRef.current },
      });
      toast.success('Presupuesto enviado al cliente.', 'Enviado');
      navigation.goBack();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo enviar el presupuesto.',
        'Error',
      );
    }
  }, [detail, freightType, freightCostText, submit, toast, navigation]);

  if ((loading && !detail) || (detail && !formReady)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Cargando pedido…</Text>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.centered}>
        <Text style={styles.warn}>{error ?? 'Pedido no disponible.'}</Text>
        <AppButton title="Reintentar" onPress={refresh} variant="secondary" />
        <AppButton title="Volver" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const locked = detail.alreadyQuoted;

  return (
    <AppKeyboardAvoidingView style={styles.flex}>
      <FlatList
        data={listData}
        keyExtractor={(row) => row.key}
        extraData={draftTick}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        removeClippedSubviews={false}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={7}
        contentContainerStyle={styles.list}
        ListHeaderComponent={null}
        renderItem={({ item: row }): ReactElement | null => {
          if (row.type === 'header') {
            return (
              <View style={styles.headerBlock}>
                <Text style={styles.title}>
                  {detail.existingQuote ? 'Cotización enviada' : 'Cotizar pedido'}
                </Text>
                <Text style={styles.meta}>
                  {detail.items.length} ítem{detail.items.length === 1 ? '' : 's'}
                </Text>
                {detail.clientAddress ? (
                  <Text style={styles.address}>Entrega: {detail.clientAddress}</Text>
                ) : detail.clientLat != null && detail.clientLng != null ? (
                  <Text style={styles.address}>
                    Entrega (coords): {detail.clientLat.toFixed(4)}, {detail.clientLng.toFixed(4)}
                  </Text>
                ) : null}
                {locked ? (
                  <Text style={styles.lockedBanner}>
                    {detail.existingQuote?.status === 'accepted'
                      ? 'El cliente ya decidió sobre este presupuesto. Prepará los ítems aceptados.'
                      : detail.existingQuote?.status === 'rejected'
                        ? 'El cliente rechazó este presupuesto.'
                        : 'Ya enviaste un presupuesto. El cliente lo ve en su bandeja.'}
                  </Text>
                ) : (
                  <Text style={styles.lead}>
                    Precio por ítem. Podés abrir hasta 3 opciones (marcas). Si no tenés stock,
                    marcá “Sin stock” y, si querés, proponé alternativas con precio.
                  </Text>
                )}
              </View>
            );
          }
          if (row.type === 'item') {
            const draft = itemDraftsRef.current[row.item.id] ?? EMPTY_DRAFT;
            const decision =
              detail.existingQuote?.items.find((it) => it.requestItemId === row.item.id)
                ?.clientDecision ?? 'pending';
            return (
              <QuoteItemRow
                key={`qi-${row.item.id}-${draftTick}`}
                item={row.item}
                editable={!locked}
                draft={draft}
                clientDecision={decision}
                onPatch={(patch) => patchItemDraft(row.item.id, patch)}
              />
            );
          }
          if (row.type === 'logistics') {
            return (
              <LogisticsBlock
                freightType={freightType}
                freightCostText={freightCostText}
                editable={!locked}
                onFreightTypeChange={setFreightType}
                onFreightCostChange={(t) => {
                  const cleaned = sanitizePriceText(t);
                  freightCostRef.current = cleaned;
                  setFreightCostText(cleaned);
                }}
              />
            );
          }
          if (row.type === 'notes') {
            return (
              <NotesBlock
                key={`notes-${draftTick}`}
                editable={!locked}
                initialValue={notesInitial}
                onChange={(t) => {
                  notesRef.current = t;
                }}
              />
            );
          }
          return <View style={styles.footerSpacer} />;
        }}
      />

      {!locked ? (
        <View style={styles.footer}>
          <AppButton
            title="Enviar Presupuesto al Cliente"
            onPress={() => void handleSend()}
            loading={submitting}
          />
        </View>
      ) : null}
    </AppKeyboardAvoidingView>
  );
}

const QuoteItemRow = memo(function QuoteItemRow({
  item,
  editable,
  draft,
  clientDecision = 'pending',
  onPatch,
}: {
  item: MaterialRequestItem;
  editable: boolean;
  draft: QuoteItemDraftState;
  clientDecision?: ExistingStoreQuoteItem['clientDecision'];
  onPatch: (patch: Partial<QuoteItemDraftState>) => void;
}) {
  const variants = draft.variants.length > 0 ? draft.variants : [{ label: '', priceText: '' }];
  const inStock = draft.inStock;
  const itemNote = draft.itemNote.trim();

  const updateVariant = (index: number, patch: Partial<{ label: string; priceText: string }>) => {
    const next = variants.map((v, i) => (i === index ? { ...v, ...patch } : v));
    onPatch({ variants: next });
  };

  const addVariant = () => {
    if (variants.length >= 3) return;
    onPatch({ variants: [...variants, { label: '', priceText: '' }] });
  };

  const removeVariant = (index: number) => {
    if (variants.length <= 1) return;
    onPatch({ variants: variants.filter((_, i) => i !== index) });
  };

  if (!editable) {
    const decisionLabel =
      clientDecision === 'accepted'
        ? 'Aceptado'
        : clientDecision === 'rejected'
          ? 'Rechazado'
          : null;
    return (
      <View
        style={[
          styles.itemCard,
          styles.itemCardReadonly,
          !inStock && styles.itemCardAlt,
          clientDecision === 'rejected' && styles.itemCardRejected,
        ]}
      >
        <View style={styles.roTitleRow}>
          <Text style={[styles.itemDesc, { flex: 1 }]} numberOfLines={4}>
            {item.description}
          </Text>
          {decisionLabel ? (
            <Text
              style={[
                styles.decisionBadge,
                clientDecision === 'accepted' ? styles.decisionOk : styles.decisionNo,
              ]}
            >
              {decisionLabel}
            </Text>
          ) : null}
        </View>

        <View style={styles.roMetaList}>
          <View style={styles.roMetaRow}>
            <Text style={styles.roMetaLabel}>Stock</Text>
            <Text style={[styles.roMetaValue, !inStock && styles.roMetaValueWarn]}>
              {inStock ? 'Con stock' : 'Sin stock'}
            </Text>
          </View>
          {variants.map((v, i) => (
            <View key={`ro-v-${i}`} style={styles.roMetaBlock}>
              <Text style={styles.roMetaLabel}>
                {v.label.trim() || (variants.length > 1 ? `Opción ${i + 1}` : 'Precio')}
              </Text>
              <Text style={styles.roMetaValue}>{formatDraftPrice(v.priceText)}</Text>
            </View>
          ))}
          {itemNote ? (
            <View style={styles.roMetaBlock}>
              <Text style={styles.roMetaLabel}>Nota</Text>
              <Text style={styles.roNoteText}>{itemNote}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.itemCard, !inStock && styles.itemCardAlt]}>
      <Text style={styles.itemDesc} numberOfLines={4}>
        {item.description}
      </Text>

      <View style={styles.stockRow}>
        <Text style={[styles.stockLabel, !inStock && styles.stockLabelOff]}>
          {inStock ? 'Con stock' : 'Sin stock'}
        </Text>
        <Switch
          value={!inStock}
          disabled={!editable}
          onValueChange={(noStock) => {
            onPatch({ inStock: !noStock });
          }}
          trackColor={{ false: colors.border, true: '#F5A9A9' }}
          thumbColor={!inStock ? colors.primary : '#f4f3f4'}
          accessibilityLabel="Sin stock"
        />
      </View>

      <Text style={styles.altTitle}>
        {inStock ? 'Opciones / marcas (hasta 3)' : 'Alternativas (opcional, hasta 3)'}
      </Text>
      <Text style={styles.altHint}>
        {inStock
          ? 'Podés cotizar hasta 3 marcas o presentaciones. El cliente elige una.'
          : 'Sin alternativa podés dejarlo vacío. Si cargás alternativa, el precio es obligatorio.'}
      </Text>

      {variants.map((v, index) => (
        <View key={`var-${index}`} style={styles.variantRow}>
          <TextInput
            value={v.label}
            editable={editable}
            onChangeText={(t) => updateVariant(index, { label: t })}
            placeholder={
              inStock
                ? `Marca / opción ${index + 1} (opcional)`
                : `Alternativa ${index + 1} (opcional)`
            }
            placeholderTextColor={colors.textSecondary}
            style={[styles.altInput, { flex: 1 }]}
            maxLength={120}
          />
          <TextInput
            value={v.priceText}
            editable={editable}
            onChangeText={(raw) => updateVariant(index, { priceText: sanitizePriceText(raw) })}
            keyboardType="decimal-pad"
            placeholder="$"
            placeholderTextColor={colors.textSecondary}
            style={[styles.priceInput, styles.variantPrice]}
            selectTextOnFocus
            maxLength={12}
          />
          {variants.length > 1 ? (
            <Pressable onPress={() => removeVariant(index)} hitSlop={8}>
              <Text style={styles.variantRemove}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {variants.length < 3 ? (
        <Pressable onPress={addVariant} style={styles.addVariantBtn}>
          <Text style={styles.addVariantText}>+ Agregar opción</Text>
        </Pressable>
      ) : null}

      <TextInput
        value={draft.itemNote}
        editable={editable}
        onChangeText={(t) => onPatch({ itemNote: t })}
        placeholder="Nota del ítem (opcional)"
        placeholderTextColor={colors.textSecondary}
        style={styles.itemNoteInput}
        maxLength={160}
      />
    </View>
  );
});

function LogisticsBlock({
  freightType,
  freightCostText,
  editable,
  onFreightTypeChange,
  onFreightCostChange,
}: {
  freightType: FreightType;
  freightCostText: string;
  editable: boolean;
  onFreightTypeChange: (t: FreightType) => void;
  onFreightCostChange: (t: string) => void;
}) {
  if (!editable) {
    const costNum = Number(String(freightCostText).replace(',', '.'));
    const showCost =
      freightType === 'cost' && Number.isFinite(costNum) && costNum >= 0;
    return (
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Logística</Text>
        <View style={styles.roMetaList}>
          <View style={styles.roMetaRow}>
            <Text style={styles.roMetaValue}>{freightOptionLabel(freightType)}</Text>
          </View>
          {showCost ? (
            <View style={styles.roMetaRow}>
              <Text style={styles.roMetaLabel}>Costo</Text>
              <Text style={styles.roMetaValue}>{formatMoneyAr(costNum)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Logística</Text>
      {FREIGHT_OPTIONS.map((opt) => {
        const selected = freightType === opt.value;
        return (
          <Pressable
            key={opt.value}
            disabled={!editable}
            onPress={() => onFreightTypeChange(opt.value)}
            style={styles.radioRow}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={[styles.radioOuter, selected && styles.radioOuterOn]}>
              {selected ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.radioLabel}>{opt.label}</Text>
          </Pressable>
        );
      })}
      {freightType === 'cost' ? (
        <View style={styles.freightCostRow}>
          <Text style={styles.priceLabel}>Costo flete ($)</Text>
          <TextInput
            value={freightCostText}
            editable={editable}
            onChangeText={onFreightCostChange}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
            style={styles.freightInput}
            selectTextOnFocus
            maxLength={12}
          />
        </View>
      ) : null}
    </View>
  );
}

function NotesBlock({
  editable,
  initialValue = '',
  onChange,
}: {
  editable: boolean;
  initialValue?: string;
  onChange: (t: string) => void;
}) {
  const [text, setText] = useState(initialValue);
  const trimmed = text.trim();

  if (!editable) {
    if (!trimmed) return null;
    return (
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Notas generales</Text>
        <Text style={styles.roNotesBody}>{trimmed}</Text>
      </View>
    );
  }

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Notas generales</Text>
      <Text style={styles.notesHint}>Opcional — comentarios para todo el pedido</Text>
      <TextInput
        value={text}
        editable={editable}
        onChangeText={(t) => {
          setText(t);
          onChange(t);
        }}
        placeholder="Ej: Disponibilidad inmediata, horarios de retiro…"
        placeholderTextColor={colors.textSecondary}
        style={styles.notesInput}
        multiline
        maxLength={500}
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  muted: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  warn: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
  },
  headerBlock: {
    marginBottom: spacing.md,
    gap: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  address: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
    lineHeight: 18,
  },
  lead: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 4,
  },
  lockedBanner: {
    marginTop: 8,
    padding: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: '#E8F5E9',
    color: '#1B5E20',
    fontSize: 13,
    fontWeight: '600',
  },
  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  itemCardReadonly: {
    gap: spacing.sm,
  },
  itemCardAlt: {
    borderColor: colors.primary,
    backgroundColor: '#FFF8F8',
  },
  itemCardRejected: {
    opacity: 0.72,
  },
  roTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  decisionBadge: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  decisionOk: {
    color: '#1B5E20',
    backgroundColor: '#E8F5E9',
  },
  decisionNo: {
    color: colors.textSecondary,
    backgroundColor: '#F3F4F6',
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  itemInfo: { flex: 1, gap: 4 },
  itemDesc: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  itemQty: {
    fontSize: 13,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  roMetaList: {
    gap: 8,
  },
  roMetaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  roMetaBlock: {
    gap: 2,
  },
  roMetaLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  roMetaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  roMetaValueWarn: {
    color: colors.primary,
  },
  roAltText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    lineHeight: 20,
  },
  roNoteText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  roNotesBody: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  priceCol: {
    width: 96,
    alignItems: 'stretch',
  },
  priceLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 4,
    textAlign: 'center',
  },
  priceInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stockLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  stockLabelOff: {
    color: colors.primary,
  },
  altBlock: {
    gap: 6,
    paddingTop: 4,
  },
  altTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  altHint: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  altInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.text,
  },
  altPriceRow: {
    marginTop: 4,
    maxWidth: 160,
  },
  altPriceInput: {
    width: '100%',
  },
  itemNoteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: colors.text,
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  variantPrice: {
    width: 88,
  },
  variantRemove: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  addVariantBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: 8,
  },
  addVariantText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  freightCostRow: {
    marginTop: spacing.sm,
  },
  freightInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  notesHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  notesInput: {
    minHeight: 88,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    padding: spacing.md,
    fontSize: 14,
    color: colors.text,
  },
  footerSpacer: { height: 12 },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
