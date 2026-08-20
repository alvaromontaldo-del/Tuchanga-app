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
import { LocationMap } from '../../components/location/LocationMap';
import { useAppToast } from '../../components/toast/toast';
import { isSupabaseConfigured } from '../../config/supabase';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCommerceShell } from '../../context/CommerceShellContext';
import type { CommerceStackParamList } from '../../navigation/mainTypes';
import {
  fetchStoreRubrosCatalog,
  registerMyStore,
} from '../../services/storeRegistrationSupabase';
import type { StoreRubro } from '../../types/materials';
import {
  defaultStoreOpeningHours,
  type StoreHoursSlot,
} from '../../utils/storeOpeningHours';
import { getHighAccuracyPosition } from '../../utils/deviceGeolocation';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<CommerceStackParamList, 'RegisterStore'>;

/**
 * Alta de comercio del usuario → queda en pending_approval hasta que admin apruebe.
 */
export function RegisterStoreScreen({ navigation }: Props) {
  const toast = useAppToast();
  const { user } = useAuth();
  const { refresh: refreshCommerceShell } = useCommerceShell();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState(user?.baseLocation?.address ?? '');
  const [lat, setLat] = useState<number | null>(user?.baseLocation?.lat ?? null);
  const [lng, setLng] = useState<number | null>(user?.baseLocation?.lng ?? null);
  const [rubros, setRubros] = useState<StoreRubro[]>([]);
  const [selectedRubros, setSelectedRubros] = useState<string[]>([]);
  const [openingHours, setOpeningHours] = useState<StoreHoursSlot[]>(defaultStoreOpeningHours);
  const [rubrosLoading, setRubrosLoading] = useState(true);
  const [locating, setLocating] = useState(false);
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

  const locateMe = useCallback(async () => {
    setLocating(true);
    try {
      const result = await getHighAccuracyPosition();
      if (!result.ok) {
        toast.warning(
          result.reason === 'denied'
            ? 'Necesitamos permiso de ubicación.'
            : 'No se pudo obtener el GPS.',
          'Ubicación',
        );
        return;
      }
      setLat(result.position.lat);
      setLng(result.position.lng);
      toast.success('Ubicación del local actualizada.', 'GPS');
    } finally {
      setLocating(false);
    }
  }, [toast]);

  const handleSubmit = useCallback(async () => {
    if (lat == null || lng == null) {
      toast.warning('Marcá la ubicación del local (GPS o mapa).', 'Ubicación');
      return;
    }
    if (selectedRubros.length === 0) {
      toast.warning('Seleccioná al menos un rubro.', 'Rubros');
      return;
    }
    setSubmitting(true);
    try {
      await registerMyStore({
        name,
        phone,
        address,
        latitude: lat,
        longitude: lng,
        rubroIds: selectedRubros,
        openingHours,
      });
      toast.success(
        'Registro enviado. Cuando un admin lo apruebe vas a poder recibir cotizaciones.',
        'Listo',
      );
      refreshCommerceShell();
      navigation.reset({
        index: 0,
        routes: [{ name: 'StoreMaterialRequests' }],
      });
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
    navigation,
    refreshCommerceShell,
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
        <AppTextInput
          label="Dirección *"
          value={address}
          onChangeText={setAddress}
          placeholder="Calle, número, localidad"
          maxLength={200}
        />

        <StoreOpeningHoursEditor slots={openingHours} onChange={setOpeningHours} />

        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <Ionicons name="location-outline" size={20} color={colors.primary} />
            <Text style={styles.locationTitle}>Ubicación del local *</Text>
          </View>
          <Text style={styles.locationHint}>
            {lat != null && lng != null
              ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
              : 'Todavía sin coordenadas'}
          </Text>
          <AppButton
            title={locating ? 'Obteniendo GPS…' : 'Usar mi ubicación (GPS)'}
            onPress={() => void locateMe()}
            loading={locating}
            variant="secondary"
            style={styles.gpsBtn}
          />
          {lat != null && lng != null ? (
            <View style={styles.mapWrap}>
              <LocationMap
                geo={{ lat, lng }}
                coverageMeters={0}
                showCoverage={false}
                locating={locating}
                onLocateMe={() => void locateMe()}
                onPinMoved={(nextLat, nextLng) => {
                  setLat(nextLat);
                  setLng(nextLng);
                }}
              />
            </View>
          ) : null}
        </View>

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
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  locationCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  locationHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  gpsBtn: { marginBottom: spacing.sm },
  mapWrap: {
    height: 220,
    borderRadius: radii.input,
    overflow: 'hidden',
    marginTop: spacing.xs,
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
