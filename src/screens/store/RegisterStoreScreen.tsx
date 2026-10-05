import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components/common/AppButton';
import { StoreOpeningHoursEditor } from '../../components/store/StoreOpeningHoursEditor';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { AddressDeliveryField } from '../../components/location/AddressDeliveryField';
import { useAppToast } from '../../components/toast/toast';
import { isSupabaseConfigured } from '../../config/supabase';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCommerceShell } from '../../context/CommerceShellContext';
import { showPendingCommerceNoticeOnce } from '../../context/pendingCommerceNotice';
import { navigateToInicioTab } from '../../navigation/openAuthModal';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import {
  fetchStoreRubrosCatalog,
  registerMyStore,
} from '../../services/storeRegistrationSupabase';
import type { StoreRubro } from '../../types/materials';
import {
  defaultStoreWeekSchedule,
  type StoreDaySchedule,
} from '../../utils/storeOpeningHours';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<CommerceStackParamList, 'RegisterStore'>;

/**
 * Alta de comercio del usuario → queda en pending_approval hasta que admin apruebe.
 */
export function RegisterStoreScreen({ navigation }: Props) {
  const toast = useAppToast();
  const { user } = useAuth();
  const { refresh: refreshCommerceShell, chooseSessionRole } = useCommerceShell();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState(user?.baseLocation?.address ?? '');
  const [lat, setLat] = useState<number | null>(user?.baseLocation?.lat ?? null);
  const [lng, setLng] = useState<number | null>(user?.baseLocation?.lng ?? null);
  const [rubros, setRubros] = useState<StoreRubro[]>([]);
  const [selectedRubros, setSelectedRubros] = useState<string[]>([]);
  const [openingHours, setOpeningHours] = useState<StoreDaySchedule[]>(defaultStoreWeekSchedule());
  const [rubrosLoading, setRubrosLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isSupabaseConfigured()) {
        setRubrosLoading(false);
        return;
      }
      setRubrosLoading(true);
      try {
        const list = await fetchStoreRubrosCatalog();
        if (!cancelled) setRubros(list);
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : 'No se pudieron cargar los rubros.',
            'Rubros',
          );
        }
      } finally {
        if (!cancelled) setRubrosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Carga única al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRubro = useCallback((id: string) => {
    setSelectedRubros((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (lat == null || lng == null) {
      toast.warning('Elegí una dirección de las sugerencias para ubicar el local.', 'Ubicación');
      return;
    }
    if (selectedRubros.length === 0) {
      toast.warning('Seleccioná al menos un rubro.', 'Rubros');
      return;
    }
    setSubmitting(true);
    try {
      const created = await registerMyStore({
        name,
        phone,
        address,
        latitude: lat,
        longitude: lng,
        rubroIds: selectedRubros,
        openingHours,
      });
      await refreshCommerceShell();
      if (created.status === 'pending_approval') {
        showPendingCommerceNoticeOnce(user?.id);
        await chooseSessionRole('client');
        setTimeout(() => navigateToInicioTab(), 0);
      } else {
        navigation.reset({
          index: 0,
          routes: [{ name: 'StoreMaterialRequests' }],
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo registrar el comercio.', 'Error');
    } finally {
      setSubmitting(false);
    }
  }, [
    lat,
    lng,
    name,
    phone,
    address,
    selectedRubros,
    openingHours,
    toast,
    refreshCommerceShell,
    chooseSessionRole,
    user?.id,
    navigation,
  ]);

  return (
    <AppKeyboardAvoidingView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          Completá los datos de tu local. Un administrador revisará el alta antes de que puedas
          recibir listas de materiales.
        </Text>

        <AppTextInput
          label="Nombre del comercio *"
          value={name}
          onChangeText={setName}
          placeholder="Ej. Ferretería El Tornillo"
          maxLength={120}
        />
        <AppTextInput
          label="Teléfono / WhatsApp"
          value={phone}
          onChangeText={setPhone}
          placeholder="Ej. 11 5555-5555"
          keyboardType="phone-pad"
          maxLength={40}
        />
        <Text style={styles.hint}>
          Buscá la calle y elegí una sugerencia para ver el mapa. Si no queda exacto, mové el pin.
        </Text>
        <AddressDeliveryField
          label="Dirección *"
          showUseCurrentLocation={false}
          showMap
          value={address}
          onChangeText={setAddress}
          geo={lat != null && lng != null ? { address, lat, lng } : null}
          onGeoChange={(point) => {
            if (!point) {
              setLat(null);
              setLng(null);
              return;
            }
            setAddress(point.address);
            setLat(point.lat);
            setLng(point.lng);
          }}
          placeholder="Calle, número, localidad"
        />

        <StoreOpeningHoursEditor days={openingHours} onChange={setOpeningHours} />

        <Text style={styles.sectionLabel}>Rubros * (podés elegir varios)</Text>
        {rubrosLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : (
          <View style={styles.rubrosBox}>
            {rubros.length === 0 ? (
              <Text style={styles.muted}>No hay rubros cargados en la plataforma.</Text>
            ) : (
              rubros.map((r) => {
                const checked = selectedRubros.includes(r.id);
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => toggleRubro(r.id)}
                    style={[styles.rubroRow, checked && styles.rubroRowOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? colors.primary : colors.textSecondary}
                    />
                    <Text style={styles.rubroText}>{r.name}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        <AppButton
          title="Enviar registro para aprobación"
          onPress={() => void handleSubmit()}
          loading={submitting}
          style={styles.submit}
        />
      </ScrollView>
    </AppKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  lead: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  rubrosBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.lg,
    gap: 4,
  },
  rubroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radii.input,
  },
  rubroRowOn: {
    backgroundColor: '#FFF8F8',
  },
  rubroText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  muted: {
    fontSize: 14,
    color: colors.textSecondary,
    padding: spacing.sm,
  },
  submit: {
    marginTop: spacing.sm,
  },
});
