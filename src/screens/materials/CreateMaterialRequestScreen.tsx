import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { SingleSelectModal } from '../../components/common/SingleSelectModal';
import {
  AddressDeliveryField,
  type DeliveryGeoPoint,
} from '../../components/location/AddressDeliveryField';
import { useAppToast } from '../../components/toast/toast';
import { rejectedAddressMessage } from '../../utils/streetAddressQuery';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useUserMode } from '../../context/UserModeContext';
import { useCreateMaterialRequest } from '../../hooks/useCreateMaterialRequest';
import type {
  AgendaStackParamList,
  FeedStackParamList,
  MessagesStackParamList,
  SearchStackParamList,
} from '../../navigation/mainTypes';
import { fetchRubrosWithActiveStores } from '../../services/materialRequestsSupabase';
import { fetchProfileDeliveryAddress } from '../../services/supabaseUser';
import type { MaterialItemDraft, StoreRubro } from '../../types/materials';

type MaterialNavParamList =
  | MessagesStackParamList
  | FeedStackParamList
  | AgendaStackParamList
  | SearchStackParamList;

type Props = {
  navigation: NativeStackNavigationProp<MaterialNavParamList, 'CreateMaterialRequest'>;
  route: RouteProp<MaterialNavParamList, 'CreateMaterialRequest'>;
};

function newLocalId() {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyItem(): MaterialItemDraft {
  return {
    localId: newLocalId(),
    description: '',
  };
}

/**
 * Crear y enviar lista de materiales a todos los comercios del rubro elegido.
 */
export function CreateMaterialRequestScreen({ navigation, route }: Props) {
  const toast = useAppToast();
  const { user } = useAuth();
  const { isWorker } = useUserMode();
  const { submit, submitting } = useCreateMaterialRequest();

  const paramLat = route.params?.clientLat;
  const paramLng = route.params?.clientLng;
  const clientId = route.params?.clientId;
  const conversationId = route.params?.conversationId;

  const [title] = useState(route.params?.title?.trim() || 'Pedido de materiales');
  const [items, setItems] = useState<MaterialItemDraft[]>([emptyItem()]);
  const [address, setAddress] = useState('');
  const [deliveryGeo, setDeliveryGeo] = useState<DeliveryGeoPoint | null>(null);
  const [clientLat, setClientLat] = useState<number | null>(
    typeof paramLat === 'number' ? paramLat : null,
  );
  const [clientLng, setClientLng] = useState<number | null>(
    typeof paramLng === 'number' ? paramLng : null,
  );
  const [loadingClientLoc, setLoadingClientLoc] = useState(false);

  const [rubros, setRubros] = useState<StoreRubro[]>([]);
  const [loadingRubros, setLoadingRubros] = useState(true);
  const [rubrosError, setRubrosError] = useState<string | null>(null);
  const [selectedRubroId, setSelectedRubroId] = useState<string | null>(null);
  const [rubroPickerOpen, setRubroPickerOpen] = useState(false);
  const [focusLocalId, setFocusLocalId] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, TextInputType>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoadingRubros(true);
    setRubrosError(null);
    void (async () => {
      try {
        const list = await fetchRubrosWithActiveStores();
        if (cancelled) return;
        setRubros(list);
        if (list.length === 1) setSelectedRubroId(list[0].id);
      } catch (e) {
        if (!cancelled) {
          setRubros([]);
          setRubrosError(
            e instanceof Error ? e.message : 'No se pudieron cargar los rubros.',
          );
        }
      } finally {
        if (!cancelled) setLoadingRubros(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoadingClientLoc(true);
    void (async () => {
      try {
        const loc = await fetchProfileDeliveryAddress(clientId);
        if (cancelled || !loc) return;
        if (loc.address) setAddress(loc.address);
        if (typeof paramLat !== 'number' && loc.lat != null) setClientLat(loc.lat);
        if (typeof paramLng !== 'number' && loc.lng != null) setClientLng(loc.lng);
        if (loc.address && loc.lat != null && loc.lng != null) {
          setDeliveryGeo({ address: loc.address, lat: loc.lat, lng: loc.lng });
        }
      } finally {
        if (!cancelled) setLoadingClientLoc(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, paramLat, paramLng]);

  const selectedRubro = useMemo(
    () => rubros.find((r) => r.id === selectedRubroId) ?? null,
    [rubros, selectedRubroId],
  );

  const rubroNames = useMemo(() => rubros.map((r) => r.name), [rubros]);

  const updateItem = useCallback((localId: string, patch: Partial<MaterialItemDraft>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)));
  }, []);

  const removeItem = useCallback((localId: string) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.localId !== localId)));
  }, []);

  const addItem = useCallback(() => {
    const next = emptyItem();
    setFocusLocalId(next.localId);
    setItems((prev) => [...prev, next]);
  }, []);

  useEffect(() => {
    if (!focusLocalId) return;
    const t = setTimeout(() => {
      inputRefs.current.get(focusLocalId)?.focus();
      setFocusLocalId(null);
    }, 80);
    return () => clearTimeout(t);
  }, [focusLocalId, items]);

  const handleSend = useCallback(async () => {
    if (!user?.id) {
      toast.warning('Tenés que iniciar sesión.', 'Sesión');
      return;
    }
    if (!selectedRubroId) {
      toast.warning('Seleccioná el rubro.', 'Rubro');
      return;
    }
    const trimmedAddress = (deliveryGeo?.address ?? address).trim();
    if (!trimmedAddress) {
      toast.warning('Ingresá la dirección de entrega.', 'Dirección');
      return;
    }
    if (!deliveryGeo) {
      const rejected = rejectedAddressMessage(address);
      if (rejected) {
        toast.warning(rejected, 'Dirección');
        return;
      }
    }

    const cleaned: MaterialItemDraft[] = [];
    for (const it of items) {
      const description = it.description.trim();
      if (!description) {
        toast.warning('Completá cada ítem.', 'Ítems');
        return;
      }
      cleaned.push({
        localId: it.localId,
        description,
      });
    }
    if (cleaned.length === 0) {
      toast.warning('Agregá al menos un ítem.', 'Ítems');
      return;
    }

    const autoTitle =
      title.trim() ||
      (cleaned[0]?.description
        ? cleaned[0].description.slice(0, 60)
        : 'Pedido de materiales');

    const lat = deliveryGeo?.lat ?? clientLat;
    const lng = deliveryGeo?.lng ?? clientLng;

    try {
      const result = await submit({
        professionalId: user.id,
        clientId,
        clientLat: lat,
        clientLng: lng,
        clientAddress: trimmedAddress,
        conversationId,
        title: autoTitle,
        items: cleaned,
        rubroId: selectedRubroId,
      });
      toast.success(
        `Enviado a ${result.storeCount} comercio${result.storeCount === 1 ? '' : 's'}.`,
        'Listo',
      );
      navigation.goBack();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo enviar la solicitud.',
        'Error',
      );
    }
  }, [
    user?.id,
    title,
    selectedRubroId,
    address,
    deliveryGeo,
    items,
    submit,
    clientId,
    clientLat,
    clientLng,
    conversationId,
    toast,
    navigation,
  ]);

  if (!isWorker) {
    return (
      <View style={styles.centered}>
        <Text style={styles.warn}>
          Solo profesionales pueden crear solicitudes de materiales.
        </Text>
        <AppButton title="Volver" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const busy = submitting;

  return (
    <AppKeyboardAvoidingView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AddressDeliveryField
          label="Dirección de entrega"
          value={address}
          onChangeText={setAddress}
          geo={deliveryGeo}
          onGeoChange={(g) => {
            setDeliveryGeo(g);
            if (g) {
              setAddress(g.address);
              setClientLat(g.lat);
              setClientLng(g.lng);
            }
          }}
          placeholder={loadingClientLoc ? 'Cargando…' : 'Calle, altura, localidad'}
          near={
            clientLat != null && clientLng != null ? { lat: clientLat, lng: clientLng } : null
          }
        />

        <Text style={styles.sectionLabel}>Rubro</Text>
        {loadingRubros ? (
          <ActivityIndicator color={colors.primary} style={{ marginBottom: spacing.md }} />
        ) : rubrosError ? (
          <Text style={styles.warnInline}>{rubrosError}</Text>
        ) : rubros.length === 0 ? (
          <Text style={styles.warnInline}>No hay comercios activos con rubros cargados.</Text>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.rubroBtn, pressed && styles.pressed]}
            onPress={() => setRubroPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Seleccionar rubro"
          >
            <Text style={styles.rubroBtnTitle}>
              {selectedRubro ? selectedRubro.name : 'Elegí un rubro'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        )}

        <Text style={styles.sectionLabel}>Ítems</Text>
        {items.map((item, index) => (
          <View key={item.localId} style={styles.itemRow}>
            <TextInput
              ref={(ref) => {
                if (ref) inputRefs.current.set(item.localId, ref);
                else inputRefs.current.delete(item.localId);
              }}
              value={item.description}
              onChangeText={(t) => updateItem(item.localId, { description: t })}
              placeholder={`Ítem ${index + 1} (ej: Manguera ½″ × 2 m)`}
              placeholderTextColor={colors.textSecondary}
              style={styles.itemInput}
              maxLength={240}
            />
            {items.length > 1 ? (
              <Pressable
                onPress={() => removeItem(item.localId)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Quitar ítem"
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ))}

        <Pressable
          onPress={addItem}
          style={({ pressed }) => [styles.addRow, pressed && styles.addRowPressed]}
          accessibilityRole="button"
          accessibilityLabel="Agregar ítem"
        >
          <Ionicons name="add" size={20} color={colors.primary} />
          <Text style={styles.addText}>Agregar ítem</Text>
        </Pressable>

        <AppButton
          title={busy ? 'Enviando…' : 'Enviar a comercios del rubro'}
          onPress={() => void handleSend()}
          loading={busy}
          disabled={loadingRubros || rubros.length === 0 || !selectedRubroId}
          style={styles.nextBtn}
        />
      </ScrollView>

      <SingleSelectModal
        visible={rubroPickerOpen}
        title="Rubro"
        options={rubroNames}
        value={selectedRubro?.name ?? null}
        onClose={() => setRubroPickerOpen(false)}
        onSelect={(name) => {
          const found = rubros.find((r) => r.name === name);
          if (found) setSelectedRubroId(found.id);
          setRubroPickerOpen(false);
        }}
      />
    </AppKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  warn: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  warnInline: {
    color: colors.error,
    fontSize: 14,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  lead: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  locationCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  locationCoords: {
    fontSize: 12,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
    marginBottom: spacing.xs,
  },
  locationHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  locationBtn: {
    marginTop: spacing.xs,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  gpsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
    marginBottom: spacing.lg,
  },
  gpsLinkText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  itemInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    paddingVertical: 12,
  },
  itemsHint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
    marginTop: -4,
  },
  rubroLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  rubroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rubroBtnText: { flex: 1, gap: 2 },
  rubroBtnTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  rubroBtnSub: { fontSize: 12, color: colors.textSecondary },
  pressed: { opacity: 0.9 },
  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  itemIndex: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  row2: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  qtyCol: { width: 100 },
  unitCol: { flex: 1 },
  unitLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
    marginLeft: 4,
  },
  unitChips: {
    gap: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FDECEA',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.primary,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  addRowPressed: { opacity: 0.7 },
  addText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  nextBtn: {
    marginTop: spacing.sm,
  },
});
