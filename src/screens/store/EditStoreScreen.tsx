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
import { useCommerceShell } from '../../context/CommerceShellContext';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import {
  fetchMyStoreForEdit,
  fetchStoreRubrosCatalog,
  updateMyStore,
} from '../../services/storeRegistrationSupabase';
import type { StoreRubro } from '../../types/materials';
import {
  defaultStoreWeekSchedule,
  type StoreDaySchedule,
} from '../../utils/storeOpeningHours';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<CommerceStackParamList, 'EditStore'>;

/**
 * Edición de comercio: datos + rubros multi-select (sin radio de cobertura).
 */
export function EditStoreScreen({ navigation }: Props) {
  const toast = useAppToast();
  const { primaryStore, refresh: refreshCommerceShell } = useCommerceShell();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [rubros, setRubros] = useState<StoreRubro[]>([]);
  const [selectedRubros, setSelectedRubros] = useState<string[]>([]);
  const [openingHours, setOpeningHours] = useState<StoreDaySchedule[]>(defaultStoreWeekSchedule());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isSupabaseConfigured() || !primaryStore?.id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [detail, catalog] = await Promise.all([
          fetchMyStoreForEdit(primaryStore.id),
          fetchStoreRubrosCatalog(),
        ]);
        if (cancelled) return;
        setRubros(catalog);
        if (detail) {
          setName(detail.name);
          setPhone(detail.phone);
          setAddress(detail.address);
          setLat(Number.isFinite(detail.latitude) ? detail.latitude : null);
          setLng(Number.isFinite(detail.longitude) ? detail.longitude : null);
          setSelectedRubros(detail.rubroIds);
          setOpeningHours(
            detail.openingHours.length > 0 ? detail.openingHours : defaultStoreWeekSchedule(),
          );
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : 'No se pudo cargar el comercio.',
            'Error',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryStore?.id, toast]);

  const toggleRubro = useCallback((id: string) => {
    setSelectedRubros((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!primaryStore?.id) {
      toast.warning('No hay comercio seleccionado.', 'Comercio');
      return;
    }
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
      await updateMyStore({
        storeId: primaryStore.id,
        name,
        phone,
        address,
        latitude: lat,
        longitude: lng,
        rubroIds: selectedRubros,
        openingHours,
      });
      toast.success('Datos del comercio actualizados.', 'Listo');
      refreshCommerceShell();
      navigation.goBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.', 'Error');
    } finally {
      setSubmitting(false);
    }
  }, [
    primaryStore?.id,
    lat,
    lng,
    name,
    phone,
    address,
    selectedRubros,
    openingHours,
    toast,
    refreshCommerceShell,
    navigation,
  ]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.muted}>Cargando comercio…</Text>
      </View>
    );
  }

  if (!primaryStore) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Todavía no registraste un local.</Text>
        <AppButton title="Volver" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <AppKeyboardAvoidingView style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
        <View style={styles.rubrosBox}>
          {rubros.map((r) => {
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
          })}
        </View>

        <AppButton
          title="Guardar cambios"
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
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
    textAlign: 'center',
  },
  submit: {
    marginTop: spacing.sm,
  },
});
