import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../components/common/AppButton';
import { LocationMap } from '../../components/location/LocationMap';
import { TradeSearchModal } from '../../components/search/TradeSearchModal';
import { colors, radii, spacing } from '../../constants/theme';
import { fetchNominatimSuggestions, reverseNominatimStreet } from '../../config/nominatim';
import { isSupabaseConfigured } from '../../config/supabase';
import {
  type WorkerBaseLocation,
  type WorkerProfile,
  type WorkerTrade,
  useWorkerProfile,
} from '../../context/WorkerProfileContext';
import { useAuth } from '../../context/AuthContext';
import { useUserMode } from '../../context/UserModeContext';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import { persistWorkerGeoToSupabase, persistWorkerJobsToSupabase } from '../../services/supabaseUser';
import { getHighAccuracyPosition } from '../../utils/deviceGeolocation';
import { fetchSearchWorkerHitsFromSupabase } from '../../services/searchWorkersSupabase';

type Props = AccountStackScreenProps<'WorkerABM'>;

const DEFAULT_LOCATION: WorkerBaseLocation = {
  address: 'Buenos Aires, Argentina',
  lat: -34.6037,
  lng: -58.3816,
};

function normalizeDigitsOnly(input: string) {
  return input.replace(/[^0-9]/g, '');
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function newTrade(seed: Partial<WorkerTrade> = {}): WorkerTrade {
  return {
    id: `t_${Math.random().toString(16).slice(2)}`,
    name: seed.name ?? '',
    isPrimary: seed.isPrimary ?? false,
    yearsExperience: seed.yearsExperience ?? 0,
    description: seed.description ?? '',
  };
}

type ValidationIssue = { field: string; scroll: string; msg: string };

function validateDetailed(
  trades: WorkerTrade[],
  professionalDescription: string,
  geo: WorkerBaseLocation,
  coverageKmStr: string,
): { errors: Record<string, string>; scrollToKey: string | null } {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const hasName = t.name.trim().length > 0;
    if (
      !hasName &&
      (t.description.trim().length > 0 || (Number(t.yearsExperience) || 0) !== 0)
    ) {
      issues.push({
        field: `trade_${i}_name`,
        scroll: `trade_${i}`,
        msg: 'Elegí un oficio o vaciá los demás campos de esta fila.',
      });
    }
  }

  const named = trades
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.name.trim().length > 0);

  if (named.length === 0) {
    issues.push({
      field: 'trade_0_name',
      scroll: 'trade_0',
      msg: 'Cargá al menos un oficio.',
    });
  }

  if (named.length > 5) {
    issues.push({
      field: 'trade_4_name',
      scroll: 'trade_4',
      msg: 'Podés cargar hasta 5 oficios.',
    });
  }

  if (named.length > 0 && !named.some(({ t }) => t.isPrimary)) {
    const firstIdx = named[0].i;
    issues.push({
      field: 'primary',
      scroll: `trade_${firstIdx}`,
      msg: 'Marcá un oficio principal.',
    });
  }

  for (const { t, i } of named) {
    const raw = Number(t.yearsExperience);
    const y = Math.floor(Number.isFinite(raw) ? raw : 0);
    if (y < 0 || y > 60) {
      issues.push({
        field: `trade_${i}_years`,
        scroll: `trade_${i}`,
        msg: 'Entre 0 y 60 años.',
      });
    }
    if (t.description.trim().length < 10) {
      issues.push({
        field: `trade_${i}_description`,
        scroll: `trade_${i}`,
        msg: 'Mínimo 10 caracteres.',
      });
    }
  }

  if (!geo.address.trim() || geo.address.trim().length < 4) {
    issues.push({
      field: 'location',
      scroll: 'geo',
      msg: 'Buscá y elegí una dirección o usá “Ubicarme”.',
    });
  }
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
    issues.push({
      field: 'location',
      scroll: 'geo',
      msg: 'Coordenadas no válidas. Mové el pin o elegí otra dirección.',
    });
  }

  const rawKm = Number(coverageKmStr);
  if (!coverageKmStr.trim() || !Number.isFinite(rawKm) || rawKm < 1 || rawKm > 300) {
    issues.push({
      field: 'coverageKm',
      scroll: 'geo',
      msg: 'Ingresá un radio entre 1 y 300 km.',
    });
  }

  if (professionalDescription.trim().length < 20) {
    issues.push({
      field: 'professionalDescription',
      scroll: 'professional',
      msg: 'Mínimo 20 caracteres.',
    });
  }

  const errors: Record<string, string> = {};
  for (const it of issues) {
    if (!errors[it.field]) errors[it.field] = it.msg;
  }
  return { errors, scrollToKey: issues[0]?.scroll ?? null };
}

function tradeCardHasError(
  idx: number,
  trades: WorkerTrade[],
  fieldErrors: Record<string, string>,
) {
  if (fieldErrors[`trade_${idx}_name`]) return true;
  if (fieldErrors[`trade_${idx}_years`]) return true;
  if (fieldErrors[`trade_${idx}_description`]) return true;
  const firstNamed = trades.findIndex((t) => t.name.trim().length > 0);
  if (fieldErrors.primary && idx === firstNamed && firstNamed >= 0) return true;
  return false;
}

export function WorkerABMScreen({ navigation }: Props) {
  const { workerProfile, saveWorkerProfile, deleteWorkerProfile } = useWorkerProfile();
  const { setWorkerMode, setWorkerTrade } = useUserMode();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [geo, setGeo] = useState<WorkerBaseLocation>(DEFAULT_LOCATION);
  const [addressQuery, setAddressQuery] = useState(DEFAULT_LOCATION.address);
  const [coverageKm, setCoverageKm] = useState('10');
  const [professionalDescription, setProfessionalDescription] = useState(
    workerProfile?.professionalDescription ?? '',
  );
  const [trades, setTrades] = useState<WorkerTrade[]>(
    () => workerProfile?.trades?.length ? workerProfile.trades : [newTrade({ isPrimary: true })],
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteBanner, setDeleteBanner] = useState<string>('');
  const [deleteConfirmArmed, setDeleteConfirmArmed] = useState(false);

  const [searching, setSearching] = useState(false);
  const [addressResults, setAddressResults] = useState<WorkerBaseLocation[]>([]);
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  const [devicePos, setDevicePos] = useState<{ lat: number; lng: number } | null>(null);
  const requestIdRef = useRef(0);
  const reverseReqRef = useRef(0);

  const [tradeModal, setTradeModal] = useState<{ idx: number } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const layoutYs = useRef<Record<string, number>>({});

  // Reset fuerte al cambiar de usuario (evita heredar estado del formulario entre cuentas).
  useEffect(() => {
    setSaving(false);
    setFieldErrors({});
    setDeleteBanner('');
    setDeleteConfirmArmed(false);
    setAddressResults([]);
    setTradeModal(null);
    setProfessionalDescription('');
    setTrades([newTrade({ isPrimary: true })]);
    setCoverageKm('10');
    setGeo(DEFAULT_LOCATION);
    setAddressQuery(DEFAULT_LOCATION.address);
  }, [userId]);

  // Hidratar desde storage (perfil trabajador local) cuando esté disponible.
  useEffect(() => {
    if (!workerProfile) return;
    setGeo(workerProfile.baseLocation);
    setAddressQuery(workerProfile.baseLocation.address);
    setCoverageKm(String(workerProfile.coverageKm));
    setProfessionalDescription(workerProfile.professionalDescription);
    setTrades(
      workerProfile.trades.length > 0 ? workerProfile.trades : [newTrade({ isPrimary: true })],
    );
  }, [workerProfile]);

  // Si todavía no hay perfil trabajador local, usar domicilio del perfil como seed de ubicación/radio.
  useEffect(() => {
    if (workerProfile) return;
    if (user?.baseLocation?.lat == null || user.baseLocation.lng == null) return;
    setGeo({
      address: user.baseLocation.address,
      lat: user.baseLocation.lat,
      lng: user.baseLocation.lng,
    });
    setAddressQuery(user.baseLocation.address);
    setCoverageKm(String(user.worker?.coverageKm ?? 10));
    if (user.worker?.trades?.length) {
      setTrades(
        user.worker.trades.map((t) => ({
          id: t.id,
          name: t.name,
          isPrimary: Boolean(t.isPrimary),
          yearsExperience: 0,
          description: t.details ?? '',
        })),
      );
    }
  }, [
    workerProfile,
    user?.baseLocation?.address,
    user?.baseLocation?.lat,
    user?.baseLocation?.lng,
    user?.worker?.coverageKm,
    user?.worker?.trades,
  ]);

  const coverageMeters = useMemo(
    () => clampInt(Number(coverageKm) || 0, 1, 300) * 1000,
    [coverageKm],
  );

  async function runGeocode(qRaw: string) {
    const q = qRaw.trim();
    if (q.length < 4) {
      setAddressResults([]);
      return;
    }
    const reqId = ++requestIdRef.current;
    setSearching(true);
    try {
      const suggestions = await fetchNominatimSuggestions(q, {
        countryCode: 'ar',
        near: devicePos ?? undefined,
      });
      if (reqId !== requestIdRef.current) return;
      setAddressResults(
        suggestions.map((s) => ({
          address: s.address,
          lat: s.lat,
          lng: s.lng,
        })),
      );
    } finally {
      if (reqId === requestIdRef.current) setSearching(false);
    }
  }

  useEffect(() => {
    const q = addressQuery.trim();
    const t = setTimeout(() => {
      void runGeocode(q);
    }, 450);
    return () => clearTimeout(t);
  }, [addressQuery]);

  async function runReverseGeocode(lat: number, lng: number) {
    const reqId = ++reverseReqRef.current;
    try {
      const addr = await reverseNominatimStreet(lat, lng);
      if (reqId !== reverseReqRef.current) return;
      if (!addr) return;
      setGeo((prev) => ({ ...prev, address: addr, lat, lng }));
      setAddressQuery(addr);
    } catch {
      /* ignore */
    }
  }

  async function locateMe() {
    setLocationHint(null);
    setLocating(true);
    try {
      const res = await getHighAccuracyPosition();
      if (!res.ok) {
        if (res.reason === 'denied') {
          setLocationHint('Activá la ubicación en el navegador o el sistema para usar “Ubicarme”.');
        }
        return;
      }
      const { lat, lng } = res.position;
      setDevicePos({ lat, lng });
      setGeo({ address: 'Ubicación actual', lat, lng });
      setAddressResults([]);
      await runReverseGeocode(lat, lng);
    } finally {
      setLocating(false);
    }
  }

  function setPrimary(idx: number) {
    setTrades((prev) => prev.map((t, i) => ({ ...t, isPrimary: i === idx })));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.primary;
      return next;
    });
  }

  function addTrade() {
    setTrades((prev) => {
      if (prev.length >= 5) return prev;
      return [...prev, newTrade()];
    });
  }

  function removeTrade(idx: number) {
    setTrades((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) return [newTrade({ isPrimary: true })];
      if (!next.some((t) => t.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[`trade_${idx}_name`];
      delete next[`trade_${idx}_years`];
      delete next[`trade_${idx}_description`];
      return next;
    });
  }

  function updateTrade(idx: number, patch: Partial<WorkerTrade>) {
    setTrades((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
        delete next[`trade_${idx}_name`];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'yearsExperience')) {
        delete next[`trade_${idx}_years`];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
        delete next[`trade_${idx}_description`];
      }
      return next;
    });
  }

  function scrollToKey(key: string | null) {
    if (!key) return;
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        const y = layoutYs.current[key];
        if (y == null || !scrollRef.current) return;
        scrollRef.current.scrollTo({
          y: Math.max(0, y - 16),
          animated: true,
        });
      }, 80);
    });
  }

  async function onSave() {
    // Si quedó trabado en loading por algún motivo, no bloquear silenciosamente.
    if (saving) {
      Alert.alert('Guardado', 'Todavía estamos guardando. Esperá un momento y probá de nuevo.');
      return;
    }
    const { errors, scrollToKey: firstKey } = validateDetailed(
      trades,
      professionalDescription,
      geo,
      coverageKm,
    );
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setDeleteBanner('');
      const firstMsg = Object.values(errors)[0];
      Alert.alert(
        'Revisá tu perfil',
        firstMsg
          ? `Hay campos incompletos o inválidos.\n\n${firstMsg}`
          : 'Hay campos incompletos o inválidos. Revisá los marcados en rojo.',
      );
      scrollToKey(firstKey);
      return;
    }
    setFieldErrors({});
    setDeleteBanner('');
    setSaving(true);
    try {
      if (!user?.id) {
        Alert.alert('Sesión', 'Iniciá sesión para guardar tu perfil profesional.');
        return;
      }
      const trimmedTrades = trades
        .map((t) => ({
          ...t,
          name: t.name.trim(),
          description: t.description.trim(),
          yearsExperience: Math.max(0, Math.min(60, Math.floor(Number(t.yearsExperience) || 0))),
        }))
        .filter((t) => t.name.length > 0)
        .slice(0, 5);

      const km = clampInt(Number(coverageKm) || 0, 1, 300);
      const profile: WorkerProfile = {
        professionalDescription: professionalDescription.trim(),
        baseLocation: {
          address: geo.address.trim(),
          lat: geo.lat,
          lng: geo.lng,
        },
        coverageKm: km,
        trades: trimmedTrades,
        portfolioImageUrls: workerProfile?.portfolioImageUrls,
        coverageDetail: workerProfile?.coverageDetail,
        professionalLicense: workerProfile?.professionalLicense,
      };

      await saveWorkerProfile(profile);

      if (isSupabaseConfigured()) {
        try {
          await persistWorkerGeoToSupabase(profile.baseLocation, profile.coverageKm);
          if (user?.id) {
            await persistWorkerJobsToSupabase({
              userId: user.id,
              trades: trimmedTrades.map((t) => ({
                name: t.name,
                description: t.description,
                isPrimary: t.isPrimary,
              })),
            });
          }

          // Verificación rápida: el RPC debería devolver al menos este usuario si quedó visible.
          const probe = await fetchSearchWorkerHitsFromSupabase({
            clientLat: profile.baseLocation.lat,
            clientLng: profile.baseLocation.lng,
            query: '',
            categoryNames: [],
          });
          const selfVisible = probe.some((h) => h.worker.id === user.id);
          if (!selfVisible) {
            Alert.alert(
              'Sincronización incompleta',
              'Tu perfil se guardó en el teléfono, pero todavía no aparece en la búsqueda del servidor. Revisá que Supabase tenga las migraciones `update_profile_geo_coverage` y `search_workers_for_client`, y que tu perfil tenga radio > 0 y al menos un oficio.',
            );
          }
        } catch (e) {
          Alert.alert(
            'Sincronización',
            `Guardamos en el dispositivo, pero no se pudo sincronizar el perfil profesional en el servidor.\n\n${
              e instanceof Error ? e.message : 'Error desconocido.'
            }\n\nRevisá la conexión o ejecutá las migraciones SQL (ubicación/radio y jobs) en Supabase.`,
          );
        }
      }

      const primary = trimmedTrades.find((t) => t.isPrimary) ?? trimmedTrades[0];
      if (primary?.name) setWorkerTrade(primary.name);
      setWorkerMode(true);

      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('MyAccount');
      Alert.alert('Tu Changa', 'Perfil profesional guardado.');
    } catch (e) {
      Alert.alert(
        'No se pudo guardar',
        e instanceof Error ? e.message : 'Ocurrió un error inesperado al guardar.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!deleteConfirmArmed) {
      setDeleteConfirmArmed(true);
      setFieldErrors({});
      setDeleteBanner('Confirmá la baja tocando nuevamente "Dar de baja".');
      return;
    }

    await deleteWorkerProfile();
    setWorkerMode(false);
    setWorkerTrade('Profesional');
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('MyAccount');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('MyAccount');
          }}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {workerProfile ? 'Perfil profesional' : 'Ofrecer mis servicios'}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.header}>
        <Text style={styles.subtitle}>
          Completá tus datos para habilitar el Modo Trabajador.
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {deleteBanner ? (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color="#1D4ED8" />
            <Text style={styles.infoText}>{deleteBanner}</Text>
          </View>
        ) : null}

        {Object.keys(fieldErrors).length > 0 ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color="#991B1B" />
            <Text style={styles.errorText}>Revisá los campos marcados en rojo.</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Oficios (hasta 5)</Text>
        {trades.map((t, idx) => (
          <View
            key={t.id}
            collapsable={false}
            onLayout={(e) => {
              layoutYs.current[`trade_${idx}`] = e.nativeEvent.layout.y;
            }}
            style={[
              styles.tradeCard,
              tradeCardHasError(idx, trades, fieldErrors) && styles.fieldGroupError,
            ]}
          >
            <View style={styles.tradeTopRow}>
              <Pressable
                style={[
                  styles.tradePicker,
                  fieldErrors[`trade_${idx}_name`] ? styles.inputError : null,
                ]}
                onPress={() => setTradeModal({ idx })}
                accessibilityRole="button"
                accessibilityLabel={`Elegir oficio ${idx + 1}`}
              >
                <Text style={styles.tradePickerText} numberOfLines={1}>
                  {t.name.trim() ? t.name : 'Elegir oficio'}
                </Text>
                <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
              </Pressable>

              <Pressable
                onPress={() => setPrimary(idx)}
                style={[styles.primaryBtn, fieldErrors.primary ? styles.inputError : null]}
                accessibilityRole="button"
                accessibilityLabel="Marcar como principal"
              >
                <Ionicons
                  name={t.isPrimary ? 'star' : 'star-outline'}
                  size={20}
                  color={t.isPrimary ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.primaryText}>Principal</Text>
              </Pressable>
            </View>
            {fieldErrors[`trade_${idx}_name`] ? (
              <Text style={styles.inlineError}>{fieldErrors[`trade_${idx}_name`]}</Text>
            ) : null}
            {fieldErrors.primary &&
            idx === trades.findIndex((x) => x.name.trim().length > 0) ? (
              <Text style={styles.inlineError}>{fieldErrors.primary}</Text>
            ) : null}

            <View style={styles.tradeMidRow}>
              <Text style={styles.fieldLabel}>Años de experiencia</Text>
              <TextInput
                value={String(t.yearsExperience ?? 0)}
                onChangeText={(raw) => updateTrade(idx, { yearsExperience: Number(raw) || 0 })}
                keyboardType="number-pad"
                style={[
                  styles.yearsInput,
                  fieldErrors[`trade_${idx}_years`] ? styles.inputError : null,
                ]}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            {fieldErrors[`trade_${idx}_years`] ? (
              <Text style={styles.inlineError}>{fieldErrors[`trade_${idx}_years`]}</Text>
            ) : null}

            <Text style={styles.fieldLabel}>Descripción del oficio</Text>
            <TextInput
              value={t.description}
              onChangeText={(v) => updateTrade(idx, { description: v })}
              style={[
                styles.textArea,
                fieldErrors[`trade_${idx}_description`] ? styles.inputError : null,
              ]}
              placeholder="Qué hacés, qué te diferencia, herramientas, etc."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            {fieldErrors[`trade_${idx}_description`] ? (
              <Text style={styles.inlineError}>{fieldErrors[`trade_${idx}_description`]}</Text>
            ) : null}

            {trades.length > 1 ? (
              <Pressable
                onPress={() => removeTrade(idx)}
                style={({ pressed }) => [styles.removeTrade, pressed && styles.pressed]}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.removeTradeText}>Eliminar oficio</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        <Pressable
          onPress={addTrade}
          disabled={trades.length >= 5}
          style={({ pressed }) => [
            styles.addTrade,
            pressed && styles.pressed,
            trades.length >= 5 && styles.addTradeDisabled,
          ]}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.addTradeText}>Agregar oficio</Text>
        </Pressable>

        <View
          collapsable={false}
          onLayout={(e) => {
            layoutYs.current.geo = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Ubicación</Text>
          <Text style={styles.fieldHint}>
            Buscá tu dirección o usá “Ubicarme”. Mové el pin en el mapa si hace falta.
          </Text>
          {locationHint ? <Text style={styles.hintWarn}>{locationHint}</Text> : null}

          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchInputWrap,
                fieldErrors.location ? styles.inputErrorWrap : null,
              ]}
            >
              <TextInput
                style={styles.searchInput}
                value={addressQuery}
                onChangeText={(t) => {
                  setAddressQuery(t);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.location;
                    return next;
                  });
                }}
                placeholder="Calle, ciudad…"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="sentences"
              />
            </View>
            <Pressable
              style={styles.searchBtn}
              onPress={() => void runGeocode(addressQuery)}
              accessibilityRole="button"
            >
              {searching ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Ionicons name="search" size={18} color={colors.text} />
              )}
            </Pressable>
          </View>
          {fieldErrors.location ? (
            <Text style={styles.inlineError}>{fieldErrors.location}</Text>
          ) : null}

          {addressResults.length > 0 ? (
            <View style={styles.results}>
              {addressResults.map((r) => (
                <Pressable
                  key={`${r.lat}-${r.lng}-${r.address}`}
                  style={styles.resultRow}
                  onPress={() => {
                    setGeo(r);
                    setAddressQuery(r.address);
                    setAddressResults([]);
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.location;
                      return next;
                    });
                  }}
                >
                  <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                  <View style={styles.resultText}>
                    <Text style={styles.resultTitle} numberOfLines={2}>
                      {r.address}
                    </Text>
                    <Text style={styles.resultHint}>
                      {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.geoPill}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
            <Text style={styles.geoText} numberOfLines={2}>
              {geo.address} · {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}
            </Text>
          </View>

          <LocationMap
            geo={{ lat: geo.lat, lng: geo.lng }}
            coverageMeters={coverageMeters}
            showCoverage
            locating={locating}
            onLocateMe={() => void locateMe()}
            onPinMoved={(lat, lng) => {
              setGeo((prev) => ({ ...prev, lat, lng }));
              const id = ++reverseReqRef.current;
              setTimeout(() => {
                if (id !== reverseReqRef.current) return;
                void runReverseGeocode(lat, lng);
              }, 550);
            }}
          />

          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Radio de cobertura</Text>
          <Text style={styles.fieldHint}>Alcance en km desde tu ubicación base (1–300).</Text>
          <View style={styles.coverRow}>
            <TextInput
              style={[styles.coverInput, fieldErrors.coverageKm ? styles.inputError : null]}
              value={coverageKm}
              onChangeText={(t) => {
                setCoverageKm(normalizeDigitsOnly(t).slice(0, 3));
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.coverageKm;
                  return next;
                });
              }}
              keyboardType="number-pad"
              placeholder="10"
              placeholderTextColor={colors.textSecondary}
            />
            <Text style={styles.coverUnit}>km</Text>
          </View>
          {fieldErrors.coverageKm ? (
            <Text style={styles.inlineError}>{fieldErrors.coverageKm}</Text>
          ) : null}
        </View>

        <View
          collapsable={false}
          onLayout={(e) => {
            layoutYs.current.professional = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
            Descripción profesional
          </Text>
          <TextInput
            value={professionalDescription}
            onChangeText={(v) => {
              setProfessionalDescription(v);
              setFieldErrors((prev) => {
                const next = { ...prev };
                delete next.professionalDescription;
                return next;
              });
            }}
            style={[
              styles.textArea,
              { minHeight: 120 },
              fieldErrors.professionalDescription ? styles.inputError : null,
            ]}
            placeholder="Contá tu experiencia general, disponibilidad, garantías, etc."
            placeholderTextColor={colors.textSecondary}
            multiline
          />
          {fieldErrors.professionalDescription ? (
            <Text style={styles.inlineError}>{fieldErrors.professionalDescription}</Text>
          ) : null}
        </View>

      </ScrollView>

      <View style={styles.stickyActions}>
        <AppButton title="Guardar" onPress={() => void onSave()} loading={saving} />
        {workerProfile ? (
          <Pressable
            onPress={() => {
              void onDelete();
            }}
            style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
          >
            <Text style={styles.deleteText}>Dar de baja (eliminar)</Text>
          </Pressable>
        ) : null}
      </View>

      <TradeSearchModal
        visible={tradeModal != null}
        title="Elegir rubro"
        initialNombre={tradeModal ? trades[tradeModal.idx]?.name ?? null : null}
        onClose={() => setTradeModal(null)}
        onApply={(picked) => {
          if (!tradeModal) return;
          if (!picked) {
            updateTrade(tradeModal.idx, { name: '', rubroSlug: undefined });
            return;
          }
          updateTrade(tradeModal.idx, {
            name: picked.nombre,
            rubroSlug: picked.slug,
          });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: colors.text },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  subtitle: { marginTop: 6, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: 160 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { marginLeft: spacing.sm, color: '#991B1B', fontWeight: '700', flex: 1, lineHeight: 20 },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoText: { marginLeft: spacing.sm, color: '#1E40AF', fontWeight: '700', flex: 1, lineHeight: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  tradeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fieldGroupError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  tradeTopRow: { flexDirection: 'row', alignItems: 'center' },
  tradePicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
  },
  tradePickerText: { fontSize: 15, fontWeight: '700', color: colors.text, marginRight: spacing.sm, flex: 1 },
  primaryBtn: {
    marginLeft: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primaryText: { marginLeft: 6, fontSize: 12, color: colors.textSecondary, fontWeight: '700' },
  tradeMidRow: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  fieldHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  hintWarn: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
    marginBottom: spacing.sm,
  },
  yearsInput: {
    width: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    color: colors.text,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: '#DC2626',
    borderWidth: 2,
  },
  inputErrorWrap: {
    borderColor: '#DC2626',
    borderWidth: 2,
    borderRadius: radii.input,
  },
  inlineError: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#B91C1C',
  },
  removeTrade: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  removeTradeText: { marginLeft: 8, color: colors.textSecondary, fontWeight: '700' },
  addTrade: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  addTradeDisabled: { opacity: 0.55 },
  addTradeText: { marginLeft: 8, fontSize: 15, fontWeight: '800', color: colors.primary },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchInputWrap: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
  },
  searchInput: {
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  searchBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.input,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  results: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  resultText: { flex: 1 },
  resultTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  resultHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  geoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: '#ECFDF5',
    borderRadius: radii.input,
    marginBottom: spacing.sm,
  },
  geoText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  coverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
  },
  coverInput: {
    width: 88,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  coverUnit: { fontSize: 16, fontWeight: '800', color: colors.textSecondary },
  stickyActions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deleteBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  deleteText: { color: '#B91C1C', fontWeight: '800' },
  pressed: { opacity: 0.92 },
});
