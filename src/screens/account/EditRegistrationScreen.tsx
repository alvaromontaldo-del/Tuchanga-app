import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { SingleSelectModal } from '../../components/common/SingleSelectModal';
import { LocationMap } from '../../components/location/LocationMap';
import { useAppToast } from '../../components/toast/toast';
import { ClickableAvatar } from '../../components/common/ClickableAvatar';
import { ImagePickerComponent } from '../../components/common/ImagePickerComponent';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { useAuth } from '../../context/AuthContext';
import { fetchNominatimSuggestions, reverseNominatimStreet } from '../../config/nominatim';
import {
  activeStreetQuery,
  addressToPersist,
  isIgnorableAddressEcho,
  isNegligiblePinMove,
  retainHouseNumber,
  visibleSuggestionAddress,
} from '../../utils/streetAddressQuery';
import {
  DEFAULT_PHONE_COUNTRY_ID,
  getPhoneCountryById,
  PHONE_COUNTRIES,
  phoneCountryLabel,
} from '../../data/phoneCountries';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import type { AuthUser } from '../../services/auth';
import {
  fetchCurrentUserProfileFromSupabase,
  updateProfileRegistrationInSupabase,
} from '../../services/supabaseUser';
import { getHighAccuracyPosition } from '../../utils/deviceGeolocation';
import { mergeAuthUserProfile } from '../../utils/mergeAuthUserProfile';
import {
  buildInternationalPhoneDisplay,
  formatArgentinaNationalSpacing,
  parseStoredPhoneForEdit,
  sanitizeNationalPhoneDigits,
  validateNationalPhone,
} from '../../utils/validation';
import {
  birthDateIsoFromDate,
  calcAgeFromBirthDate,
  dateFromBirthDateIso,
  formatBirthDateDisplay,
  parseBirthDateParts,
} from '../../utils/birthDate';

type Props = AccountStackScreenProps<'EditRegistration'>;

type GeoPoint = { lat: number; lng: number; address: string; plainAddress?: string };

type DraftErrors = Partial<
  Record<'firstName' | 'lastName' | 'dni' | 'birthDate' | 'avatar' | 'phone' | 'location', string>
>;

function normalizeDigitsOnly(input: string) {
  return input.replace(/[^0-9]/g, '');
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function EditRegistrationScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 520);
  const { user, replaceOrMergeUser } = useAuth();
  const toast = useAppToast();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerStyle: { backgroundColor: colors.brandLogoMat },
      headerLeft: () => (
        <Pressable
          onPress={() => navigation.goBack()}
          style={headerBackStyles.wrap}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
          <Text style={headerBackStyles.label}>Volver</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dni, setDni] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthPickerOpen, setBirthPickerOpen] = useState(false);
  const [birthPickerDraft, setBirthPickerDraft] = useState<Date>(new Date(2000, 0, 1, 12, 0, 0, 0));
  const [avatarUri, setAvatarUri] = useState('');
  const [emailDisplay, setEmailDisplay] = useState('');
  const [phoneNationalDigits, setPhoneNationalDigits] = useState('');
  const [phoneCountryId, setPhoneCountryId] = useState(DEFAULT_PHONE_COUNTRY_ID);
  const [phoneCountryPickerOpen, setPhoneCountryPickerOpen] = useState(false);

  const [addressQuery, setAddressQuery] = useState('');
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [searching, setSearching] = useState(false);
  const [addressResults, setAddressResults] = useState<GeoPoint[]>([]);
  const requestIdRef = useRef(0);
  const reverseReqRef = useRef(0);
  const skipGeocodeRef = useRef<string | null>(null);
  const selectedAddressRef = useRef<string | null>(null);
  /** Texto que escribió la persona antes de elegir (calle + altura + piso). */
  const typedQueryRef = useRef<string | null>(null);
  /** Etiqueta confirmada al elegir, con la altura. No la pisa un reverso si el pin no se movió. */
  const confirmedLabelRef = useRef<string | null>(null);
  const pinMovedRef = useRef(false);
  /** Punto que pusimos nosotros (sugerencia o perfil). Un move de menos de 25 m no es un arrastre. */
  const pickedPointRef = useRef<{ lat: number; lng: number } | null>(null);
  /** Valor escrito por código. El TextInput a veces lo repite en onChangeText y no hay que tomarlo como edición. */
  const programmaticQueryRef = useRef<string | null>(null);
  const echoUntilRef = useRef(0);
  /** Invalida un GPS en vuelo si la persona ya escribió o eligió una dirección. */
  const addressSessionRef = useRef(0);
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  const [devicePos, setDevicePos] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDetails, setLocationDetails] = useState('');

  const [workerCoverageKm, setWorkerCoverageKm] = useState<number | null>(null);

  const loadGenRef = useRef(0);

  const selectedPhoneCountry = getPhoneCountryById(phoneCountryId) ?? PHONE_COUNTRIES[0];
  const phoneCountryOptions = PHONE_COUNTRIES.map((c) => phoneCountryLabel(c));

  const phoneFieldDisplay =
    phoneCountryId === 'AR'
      ? formatArgentinaNationalSpacing(phoneNationalDigits)
      : phoneNationalDigits;

  const coverageMeters =
    workerCoverageKm != null ? clampInt(workerCoverageKm, 1, 300) * 1000 : 0;
  const showCoverageOnMap = workerCoverageKm != null;

  function commitAddressQuery(next: string) {
    const trimmed = next.trim();
    programmaticQueryRef.current = trimmed;
    echoUntilRef.current = Date.now() + 500;
    skipGeocodeRef.current = trimmed;
    setAddressQuery(next);
  }

  const applyProfile = useCallback((u: AuthUser) => {
    setFirstName(u.firstName?.trim() ?? '');
    setLastName(u.lastName?.trim() ?? '');
    setDni((u.dni ?? '').trim());
    setBirthDate((u.birthDate ?? '').trim());
    setAvatarUri((u.avatarUri ?? '').trim());
    setEmailDisplay(u.email.trim());
    const parsed = parseStoredPhoneForEdit(u.phone ?? '');
    setPhoneCountryId(parsed.countryId);
    setPhoneNationalDigits(parsed.nationalDigits);
    const addr = u.baseLocation?.address?.trim() ?? u.location?.trim() ?? '';
    const lat = u.baseLocation?.lat ?? 0;
    const lng = u.baseLocation?.lng ?? 0;
    typedQueryRef.current = null;
    pinMovedRef.current = false;
    confirmedLabelRef.current = addr || null;
    selectedAddressRef.current = addr || null;
    if (addr || (lat !== 0 && lng !== 0)) {
      pickedPointRef.current = { lat, lng };
      setGeo({ address: addr || 'Ubicación', lat, lng });
      commitAddressQuery(addr);
    } else {
      pickedPointRef.current = null;
      programmaticQueryRef.current = null;
      setGeo(null);
      setAddressQuery('');
    }
    setWorkerCoverageKm(u.worker?.coverageKm ?? null);
    setLocationDetails(u.locationDetails?.trim() ?? '');
  }, []);

  useFocusEffect(
    useCallback(() => {
      const g = ++loadGenRef.current;
      setLoadingProfile(true);
      void (async () => {
        try {
          // En builds Preview/Dev Client, si faltan EXPO_PUBLIC_SUPABASE_* o el proyecto está pausado,
          // no debemos crashear/cerrar: mostramos el formulario con lo que haya en memoria.
          if (!isSupabaseConfigured()) {
            if (user) applyProfile(user);
            return;
          }

          const u = await fetchCurrentUserProfileFromSupabase();
          if (loadGenRef.current !== g) return;
          if (!u) {
            toast.error('No pudimos cargar tu perfil.', 'Sesión', { durationMs: 4200 });
            navigation.goBack();
            return;
          }
          applyProfile(u);
        } catch (e) {
          if (loadGenRef.current !== g) return;
          // En release Android un error JS puede cerrar la app. Bajamos el riesgo con un fallback claro.
          if (user) applyProfile(user);
          toast.warning(
            e instanceof Error ? e.message : 'No pudimos cargar tu perfil. Probá de nuevo.',
            'Perfil',
            { durationMs: 5200 },
          );
        } finally {
          if (loadGenRef.current === g) setLoadingProfile(false);
        }
      })();
    }, [applyProfile, navigation]),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getHighAccuracyPosition();
      if (!cancelled && res.ok) setDevicePos(res.position);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          plainAddress: s.plainAddress,
          lat: s.lat,
          lng: s.lng,
        })),
      );
    } catch {
      if (reqId === requestIdRef.current) setAddressResults([]);
    } finally {
      if (reqId === requestIdRef.current) setSearching(false);
    }
  }

  useEffect(() => {
    const q = addressQuery.trim();
    if (skipGeocodeRef.current === q) {
      skipGeocodeRef.current = null;
      return;
    }
    const t = setTimeout(() => void runGeocode(q), 450);
    return () => clearTimeout(t);
    // runGeocode usa requestIdRef y devicePos; no incluimos runGeocode para evitar re-disparos.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce solo addressQuery
  }, [addressQuery]);

  async function runReverseGeocode(lat: number, lng: number) {
    const reqId = ++reverseReqRef.current;
    try {
      const addr = await reverseNominatimStreet(lat, lng);
      if (reqId !== reverseReqRef.current) return;
      if (!addr) return;
      if (!pinMovedRef.current && confirmedLabelRef.current) return;
      const source =
        confirmedLabelRef.current ||
        activeStreetQuery(addressQuery, typedQueryRef.current) ||
        selectedAddressRef.current ||
        '';
      const kept = source ? retainHouseNumber(source, addr) : addr;
      selectedAddressRef.current = kept;
      if (pinMovedRef.current) confirmedLabelRef.current = kept;
      setGeo((prev) => (prev ? { ...prev, address: kept, lat, lng } : { address: kept, lat, lng }));
      commitAddressQuery(kept);
    } catch {
      /* ignore */
    }
  }

  async function locateMe() {
    const session = ++addressSessionRef.current;
    setLocationHint(null);
    setLocating(true);
    try {
      const res = await getHighAccuracyPosition();
      if (session !== addressSessionRef.current) return;
      if (!res.ok) {
        if (res.reason === 'denied') {
          setLocationHint('Activá la ubicación para centrar el mapa más rápido.');
        }
        return;
      }
      const { lat, lng } = res.position;
      setDevicePos({ lat, lng });
      selectedAddressRef.current = null;
      typedQueryRef.current = null;
      confirmedLabelRef.current = null;
      pinMovedRef.current = false;
      pickedPointRef.current = { lat, lng };
      setGeo({ address: 'Ubicación actual', lat, lng });
      setAddressResults([]);
      await runReverseGeocode(lat, lng);
    } finally {
      setLocating(false);
    }
  }

  function validate(): boolean {
    const next: DraftErrors = {};
    if (!firstName.trim()) next.firstName = 'El nombre es obligatorio.';
    if (!lastName.trim()) next.lastName = 'El apellido es obligatorio.';
    const dniDigits = normalizeDigitsOnly(dni);
    if (!dniDigits) next.dni = 'El DNI es obligatorio.';
    else if (dniDigits.length < 7 || dniDigits.length > 9) next.dni = 'Ingresá un DNI válido.';
    const bd = birthDate.trim();
    if (bd) {
      if (!parseBirthDateParts(bd)) next.birthDate = 'Formato esperado: AAAA-MM-DD.';
      else {
        const age = calcAgeFromBirthDate(bd);
        if (age == null) next.birthDate = 'Ingresá una fecha válida.';
        else if (age < 18) next.birthDate = 'Debés ser mayor de 18 años.';
      }
    }
    if (!avatarUri.trim()) next.avatar = 'Necesitamos una foto de perfil.';
    const phoneErr = validateNationalPhone(phoneCountryId, phoneNationalDigits);
    if (phoneErr) next.phone = phoneErr;
    if (!geo) next.location = 'Seleccioná una dirección en el mapa o la lista.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate() || !geo) return;
    const phoneIntl = buildInternationalPhoneDisplay(
      selectedPhoneCountry.dial,
      phoneCountryId,
      phoneNationalDigits,
    );
    const savedAddress = addressToPersist({
      typedQuery: activeStreetQuery(addressQuery, typedQueryRef.current),
      confirmedLabel: confirmedLabelRef.current,
      currentLabel: geo.address,
      pinMoved: pinMovedRef.current,
    });
    const baseLocation = { address: savedAddress, lat: geo.lat, lng: geo.lng };
    setSaving(true);
    try {
      if (isSupabaseConfigured()) {
        const avatarPublicUrl = await updateProfileRegistrationInSupabase({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dni: normalizeDigitsOnly(dni),
          birthDate: birthDate.trim(),
          phone: phoneIntl,
          baseLocation,
          avatarUri,
          locationDetails: locationDetails.trim(),
        });
        const fresh = await fetchCurrentUserProfileFromSupabase();
        if (fresh) {
          replaceOrMergeUser(
            mergeAuthUserProfile(user, {
              ...fresh,
              avatarUri: avatarPublicUrl || fresh.avatarUri,
            }) ?? { ...fresh, avatarUri: avatarPublicUrl || fresh.avatarUri },
          );
        } else if (user) {
          replaceOrMergeUser(
            mergeAuthUserProfile(user, { ...user, avatarUri: avatarPublicUrl }) ?? {
              ...user,
              avatarUri: avatarPublicUrl,
            },
          );
        }
      } else if (user) {
        replaceOrMergeUser(
          mergeAuthUserProfile(user, {
            ...user,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            fullName: `${firstName.trim()} ${lastName.trim()}`.trim(),
            dni: normalizeDigitsOnly(dni),
            phone: phoneIntl,
            baseLocation,
            location: savedAddress,
            avatarUri: avatarUri.trim(),
          }) ?? user,
        );
      }
      navigation.navigate('MyAccount');
      toast.success('Tus datos se actualizaron.', 'Listo');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.', 'Error', {
        durationMs: 4200,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loadingProfile) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Cargando datos…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <AppKeyboardAvoidingView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { width: contentWidth }]}>
            <Text style={styles.title}>Modificar datos</Text>
            <Text style={styles.subtitle}>
              Los cambios se guardan en tu cuenta. El correo no se puede editar acá.
            </Text>

            <Text style={styles.section}>Identidad</Text>
            <View style={styles.avatarRow}>
              <View style={styles.avatar}>
                {avatarUri ? (
                  <ClickableAvatar uri={avatarUri} style={styles.avatarImg} fill />
                ) : (
                  <Ionicons name="person" size={28} color={colors.textSecondary} />
                )}
              </View>
              <View style={styles.avatarText}>
                <Text style={styles.avatarTitle}>Foto de perfil</Text>
                <Text style={styles.avatarHint}>Se recorta a 1:1 antes de subir</Text>
              </View>
            </View>
            <ImagePickerComponent
              mode="single"
              label="Cambiar foto"
              hint="Usá cámara o galería. Recorte cuadrado automático."
              value={avatarUri}
              onChange={(next) => {
                const uri = String(next ?? '').trim();
                setAvatarUri(uri);
                setErrors((p) => ({ ...p, avatar: undefined }));
              }}
              maxCount={1}
              squareCrop
              jpegQuality={0.9}
              showPreview={false}
              defaultCameraFacing="front"
              allowCameraFlip
            />
            {errors.avatar ? <Text style={styles.error}>{errors.avatar}</Text> : null}

            <View style={styles.row2}>
              <View style={styles.col}>
                <AppTextInput
                  label="Nombre *"
                  value={firstName}
                  onChangeText={(t) => {
                    setFirstName(t);
                    setErrors((p) => ({ ...p, firstName: undefined }));
                  }}
                  autoCapitalize="words"
                  placeholder="Juan"
                  error={errors.firstName}
                />
              </View>
              <View style={styles.col}>
                <AppTextInput
                  label="Apellido *"
                  value={lastName}
                  onChangeText={(t) => {
                    setLastName(t);
                    setErrors((p) => ({ ...p, lastName: undefined }));
                  }}
                  autoCapitalize="words"
                  placeholder="Pérez"
                  error={errors.lastName}
                />
              </View>
            </View>
            <AppTextInput
              label="DNI *"
              value={dni}
              onChangeText={(t) => {
                setDni(normalizeDigitsOnly(t));
                setErrors((p) => ({ ...p, dni: undefined }));
              }}
              keyboardType="number-pad"
              placeholder="Ej.: 12345678"
              error={errors.dni}
            />

            <View style={styles.birthWrap}>
              <Text style={styles.birthLabel}>Fecha de nacimiento</Text>
              <Pressable
              onPress={() => {
                setBirthPickerDraft(dateFromBirthDateIso(birthDate) ?? new Date(2000, 0, 1, 12, 0, 0, 0));
                setBirthPickerOpen(true);
              }}
                style={({ pressed }) => [
                  styles.birthInputRow,
                  errors.birthDate ? styles.birthInputRowError : null,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Elegir fecha de nacimiento"
              >
                <TextInput
                  value={formatBirthDateDisplay(birthDate) ?? ''}
                  editable={false}
                  pointerEvents="none"
                  placeholder="DD/MM/AAAA"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.birthInput}
                />
                <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              </Pressable>
              {errors.birthDate ? <Text style={styles.birthError}>{errors.birthDate}</Text> : null}
            </View>

            <Text style={styles.section}>Contacto</Text>
            <View style={styles.emailBox}>
              <Text style={styles.emailLabel}>Correo electrónico</Text>
              <Text style={styles.emailValue}>{emailDisplay || '—'}</Text>
            </View>

            <View style={styles.phoneBlock}>
              <Text style={styles.fieldLabelStatic}>Teléfono *</Text>
              <Text style={styles.phoneHint}>
                Argentina (por defecto): +54 9 … — escribí 9 y tu número sin el 54.
              </Text>
              <View style={styles.phoneRow}>
                <Pressable
                  style={[
                    styles.phoneCountryBtn,
                    errors.phone ? styles.phoneCountryBtnError : null,
                  ]}
                  onPress={() => setPhoneCountryPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Código de país"
                >
                  <Text style={styles.phoneCountryDial}>+{selectedPhoneCountry.dial}</Text>
                  <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                </Pressable>
                <View
                  style={[
                    styles.phoneInputWrap,
                    errors.phone ? styles.phoneInputWrapError : null,
                  ]}
                >
                  <TextInput
                    style={styles.phoneInput}
                    value={phoneFieldDisplay}
                    onChangeText={(t) => {
                      setPhoneNationalDigits(sanitizeNationalPhoneDigits(t));
                      setErrors((p) => ({ ...p, phone: undefined }));
                    }}
                    keyboardType="phone-pad"
                    placeholder={phoneCountryId === 'AR' ? '9 364 565566' : 'Número local'}
                    placeholderTextColor={colors.textSecondary}
                    autoCorrect={false}
                  />
                </View>
              </View>
              {errors.phone ? <Text style={styles.phoneError}>{errors.phone}</Text> : null}
            </View>

            <Text style={styles.section}>Ubicación base *</Text>
            <Text style={styles.hint}>
              Buscá una dirección o mové el pin. Si sos trabajador, el radio de cobertura sigue en
              “Editar perfil profesional”.
            </Text>
            {locationHint ? <Text style={styles.hintWarn}>{locationHint}</Text> : null}
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrap}>
                <TextInput
                  style={styles.searchInput}
                  value={addressQuery}
                  onChangeText={(t) => {
                    if (
                      isIgnorableAddressEcho(
                        t,
                        programmaticQueryRef.current,
                        typedQueryRef.current,
                        Date.now(),
                        echoUntilRef.current,
                      )
                    ) {
                      return;
                    }
                    addressSessionRef.current += 1;
                    programmaticQueryRef.current = null;
                    selectedAddressRef.current = null;
                    typedQueryRef.current = t;
                    confirmedLabelRef.current = null;
                    pinMovedRef.current = false;
                    pickedPointRef.current = null;
                    setAddressQuery(t);
                    setGeo(null);
                    setErrors((prev) => ({ ...prev, location: undefined }));
                  }}
                  placeholder="Dirección (calle y altura, ciudad)"
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
            {errors.location ? <Text style={styles.error}>{errors.location}</Text> : null}

            {addressResults.length > 0 ? (
              <View style={styles.results}>
                {addressResults.map((r) => {
                  const label = visibleSuggestionAddress(addressQuery, typedQueryRef.current, r);
                  return (
                  <Pressable
                    key={`${r.lat}-${r.lng}-${r.plainAddress ?? r.address}`}
                    style={styles.resultRow}
                    onPress={() => {
                      const typed = activeStreetQuery(addressQuery, typedQueryRef.current);
                      addressSessionRef.current += 1;
                      typedQueryRef.current = typed;
                      confirmedLabelRef.current = label;
                      pinMovedRef.current = false;
                      selectedAddressRef.current = label;
                      pickedPointRef.current = { lat: r.lat, lng: r.lng };
                      reverseReqRef.current += 1;
                      commitAddressQuery(label);
                      setGeo({ address: label, lat: r.lat, lng: r.lng });
                      setAddressResults([]);
                    }}
                  >
                    <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                    <View style={styles.resultText}>
                      <Text style={styles.resultTitle} numberOfLines={2}>
                        {label}
                      </Text>
                      <Text style={styles.resultHint}>
                        {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                      </Text>
                    </View>
                  </Pressable>
                  );
                })}
              </View>
            ) : null}

            {geo ? (
              <View style={styles.geoPill}>
                <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                <Text style={styles.geoText} numberOfLines={2}>
                  {geo.address} · {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}
                </Text>
              </View>
            ) : null}

            {geo ? (
              <LocationMap
                geo={{ lat: geo.lat, lng: geo.lng }}
                coverageMeters={coverageMeters}
                showCoverage={showCoverageOnMap}
                locating={locating}
                onLocateMe={() => void locateMe()}
                onPinMoved={(lat: number, lng: number) => {
                  const origin = pickedPointRef.current ?? (geo ? { lat: geo.lat, lng: geo.lng } : null);
                  if (isNegligiblePinMove(origin, { lat, lng })) return;
                  pinMovedRef.current = true;
                  pickedPointRef.current = { lat, lng };
                  setGeo((prev) => (prev ? { ...prev, lat, lng } : { address: '', lat, lng }));
                  const id = ++reverseReqRef.current;
                  setTimeout(() => {
                    if (id !== reverseReqRef.current) return;
                    void runReverseGeocode(lat, lng);
                  }, 550);
                }}
              />
            ) : null}

            <Text style={styles.section}>Detalles para ubicar el domicilio</Text>
            <Text style={styles.hint}>
              Opcional. Ayudá al profesional a encontrarte (ej. rejas negras, pared azul, timbre).
            </Text>
            <TextInput
              style={styles.locationDetailsInput}
              value={locationDetails}
              onChangeText={setLocationDetails}
              placeholder="Ej. Portón negro, casa con pared celeste"
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={300}
              textAlignVertical="top"
            />

            <AppButton
              title="Guardar cambios"
              onPress={() => void handleSave()}
              loading={saving}
              style={styles.submitButton}
            />
          </View>
        </ScrollView>

        {birthPickerOpen && Platform.OS === 'android' ? (
          <DateTimePicker
            value={birthPickerDraft}
            mode="date"
            display="default"
            maximumDate={new Date()}
            onChange={(e, selected) => {
              // Cerrar primero: si no, Android vuelve a abrir el diálogo (doble aceptar).
              setBirthPickerOpen(false);
              if (e.type === 'dismissed') return;
              if (!selected) return;
              setBirthPickerDraft(selected);
              setBirthDate(birthDateIsoFromDate(selected));
              setErrors((p) => ({ ...p, birthDate: undefined }));
            }}
          />
        ) : null}

        {birthPickerOpen && Platform.OS === 'ios' ? (
          <Modal
            visible={birthPickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setBirthPickerOpen(false)}
          >
            <View style={styles.pickerBackdrop}>
              <Pressable style={styles.pickerBackdrop} onPress={() => setBirthPickerOpen(false)} />
              <View style={[styles.pickerCard, styles.pickerCardIos]}>
                <Text style={styles.pickerTitle}>Fecha de nacimiento</Text>
                <View style={styles.pickerBodyIos}>
                  <DateTimePicker
                    value={birthPickerDraft}
                    mode="date"
                    display="spinner"
                    textColor="#000"
                    locale="es"
                    maximumDate={new Date()}
                    onChange={(_e, selected) => {
                      if (!selected) return;
                      setBirthPickerDraft(selected);
                    }}
                  />
                </View>
                <View style={styles.pickerActions}>
                  <Pressable
                    onPress={() => setBirthPickerOpen(false)}
                    style={({ pressed }) => [styles.pickerBtnGhost, pressed && styles.pressed]}
                  >
                    <Text style={styles.pickerBtnGhostText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const iso = birthDateIsoFromDate(birthPickerDraft);
                      setBirthDate(iso);
                      setErrors((p) => ({ ...p, birthDate: undefined }));
                      setBirthPickerOpen(false);
                    }}
                    style={({ pressed }) => [styles.pickerBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.pickerBtnText}>Aceptar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : null}

        <SingleSelectModal
          visible={phoneCountryPickerOpen}
          title="Código de país"
          options={phoneCountryOptions}
          value={phoneCountryLabel(selectedPhoneCountry)}
          onClose={() => setPhoneCountryPickerOpen(false)}
          onSelect={(label) => {
            const found = PHONE_COUNTRIES.find((c) => phoneCountryLabel(c) === label);
            if (found) {
              setPhoneCountryId(found.id);
              setErrors((p) => ({ ...p, phone: undefined }));
            }
            setPhoneCountryPickerOpen(false);
          }}
        />
      </AppKeyboardAvoidingView>
    </SafeAreaView>
  );
}

const headerBackStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingVertical: 8,
    gap: 2,
  },
  label: { fontSize: 17, fontWeight: '600', color: colors.text },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: spacing.md, fontSize: 15, color: colors.textSecondary },
  scroll: {
    flexGrow: 1,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  card: { alignSelf: 'center', paddingTop: spacing.sm },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  section: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  hintWarn: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  error: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: spacing.sm,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { flex: 1, marginLeft: spacing.md },
  avatarTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  avatarHint: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  row2: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  emailBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginBottom: spacing.sm,
  },
  emailLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
  emailValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  phoneBlock: { marginBottom: spacing.md },
  fieldLabelStatic: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
    marginLeft: 4,
    marginTop: spacing.sm,
  },
  phoneHint: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  phoneCountryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phoneCountryBtnError: { borderColor: colors.error },
  phoneCountryDial: { fontSize: 16, fontWeight: '800', color: colors.text },
  phoneInputWrap: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  phoneInputWrapError: { borderColor: colors.error },
  phoneInput: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  phoneError: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
    marginLeft: 4,
    fontWeight: '600',
  },
  textArea: {
    minHeight: 100,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: 'top',
  },
  textAreaError: { borderColor: colors.error },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchInputWrap: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  searchBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  results: {
    marginTop: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  resultText: { flex: 1 },
  resultTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  resultHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  geoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#E8F5E9',
    borderRadius: radii.card,
  },
  geoText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },
  locationDetailsInput: {
    marginTop: spacing.sm,
    minHeight: 88,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
  submitButton: { marginTop: spacing.xl },
  birthWrap: {
    marginBottom: spacing.md,
    width: '100%',
  },
  birthLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
    marginLeft: 4,
  },
  birthInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    minHeight: 52,
    paddingRight: spacing.md,
  },
  birthInputRowError: {
    borderColor: colors.error,
  },
  birthInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    minHeight: 52,
  },
  birthError: {
    color: colors.error,
    fontSize: 12,
    marginTop: spacing.xs,
    marginLeft: 4,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerCardIos: {
    backgroundColor: '#fff',
  },
  pickerTitle: { fontSize: 14, fontWeight: '900', color: colors.text, marginBottom: spacing.sm },
  pickerActions: { marginTop: spacing.md, flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  pickerBodyIos: {
    height: 250,
    justifyContent: 'center',
  },
  pickerBtnGhost: {
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerBtnGhostText: { color: colors.text, fontWeight: '900', fontSize: 15 },
  pickerBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
  },
  pickerBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  pressed: { opacity: 0.9 },
});
