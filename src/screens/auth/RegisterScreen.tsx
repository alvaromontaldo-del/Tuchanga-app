import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../../components/common/AppButton';
import { AppTextInput } from '../../components/common/AppTextInput';
import { LocationMap } from '../../components/location/LocationMap';
import { SingleSelectModal } from '../../components/common/SingleSelectModal';
import { TradeSearchModal } from '../../components/search/TradeSearchModal';
import { TextLink } from '../../components/common/TextLink';
import { TermsAndConditionsModal } from '../../components/legal/TermsAndConditionsModal';
import { fetchNominatimSuggestions, reverseNominatimStreet } from '../../config/nominatim';
import {
  DEFAULT_PHONE_COUNTRY_ID,
  getPhoneCountryById,
  PHONE_COUNTRIES,
  phoneCountryLabel,
} from '../../data/phoneCountries';
import { getDefaultRubroNombre } from '../../data/rubrosCatalog';
import type { AuthStackScreenProps } from '../../navigation/types';
import { signUp, type WorkerTradeDraft } from '../../services/auth';
import {
  buildInternationalPhoneDisplay,
  formatArgentinaNationalSpacing,
  getPasswordRegistrationError,
  isValidEmail,
  passwordsMatch,
  sanitizeNationalPhoneDigits,
  validateNationalPhone,
} from '../../utils/validation';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { closeAuthModalAndGoToInicio } from '../../navigation/openAuthModal';
import { getHighAccuracyPosition } from '../../utils/deviceGeolocation';

type Props = AuthStackScreenProps<'Register'>;

type GeoPoint = { lat: number; lng: number; address: string };

const MAX_BIO_LEN = 500;

type DraftErrors = Partial<Record<
  | 'firstName'
  | 'lastName'
  | 'dni'
  | 'avatar'
  | 'email'
  | 'phone'
  | 'bio'
  | 'password'
  | 'confirm'
  | 'location'
  | 'coverageKm'
  | 'trades',
  string
>>;

function normalizeDigitsOnly(input: string) {
  return input.replace(/[^0-9]/g, '');
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function RegisterScreen({ navigation }: Props) {
  const { signIn, setFlashMessage } = useAuth();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 520);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});

  // Términos y condiciones (bloquea registro hasta aceptar)
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  // Identidad / contacto / seguridad
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dni, setDni] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phoneNationalDigits, setPhoneNationalDigits] = useState('');
  const [phoneCountryId, setPhoneCountryId] = useState(DEFAULT_PHONE_COUNTRY_ID);
  const [phoneCountryPickerOpen, setPhoneCountryPickerOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [bio, setBio] = useState('');

  // Ubicación base
  const [addressQuery, setAddressQuery] = useState('');
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [searching, setSearching] = useState(false);
  const [addressResults, setAddressResults] = useState<GeoPoint[]>([]);
  const requestIdRef = useRef(0);
  const reverseReqRef = useRef(0);
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  const [devicePos, setDevicePos] = useState<{ lat: number; lng: number } | null>(null);

  // Modo trabajador
  const [offerServices, setOfferServices] = useState(false);
  const [coverageKm, setCoverageKm] = useState('10');
  const [trades, setTrades] = useState<WorkerTradeDraft[]>([]);
  const [primaryTradeId, setPrimaryTradeId] = useState<string | null>(null);
  const [tradePickerOpenForId, setTradePickerOpenForId] = useState<string | null>(null);

  const selectedPhoneCountry = useMemo(
    () => getPhoneCountryById(phoneCountryId) ?? PHONE_COUNTRIES[0],
    [phoneCountryId],
  );

  const phoneCountryOptions = useMemo(
    () => PHONE_COUNTRIES.map((c) => phoneCountryLabel(c)),
    [],
  );

  const phoneFieldDisplay = useMemo(() => {
    if (phoneCountryId === 'AR') {
      return formatArgentinaNationalSpacing(phoneNationalDigits);
    }
    return phoneNationalDigits;
  }, [phoneCountryId, phoneNationalDigits]);

  function blurFirstName() {
    if (!firstName.trim()) {
      setErrors((p) => ({ ...p, firstName: 'El nombre es obligatorio.' }));
    } else {
      setErrors((p) => ({ ...p, firstName: undefined }));
    }
  }

  function blurLastName() {
    if (!lastName.trim()) {
      setErrors((p) => ({ ...p, lastName: 'El apellido es obligatorio.' }));
    } else {
      setErrors((p) => ({ ...p, lastName: undefined }));
    }
  }

  function blurDni() {
    const dniDigits = normalizeDigitsOnly(dni);
    if (!dniDigits) {
      setErrors((p) => ({ ...p, dni: 'El DNI es obligatorio.' }));
    } else if (dniDigits.length < 7 || dniDigits.length > 9) {
      setErrors((p) => ({ ...p, dni: 'Ingresá un DNI válido.' }));
    } else {
      setErrors((p) => ({ ...p, dni: undefined }));
    }
  }

  function blurEmail() {
    const t = email.trim();
    if (!t) {
      setErrors((p) => ({ ...p, email: 'El email es obligatorio.' }));
    } else if (!isValidEmail(t)) {
      setErrors((p) => ({ ...p, email: 'Ingresá un email válido (ej. nombre@ejemplo.com).' }));
    } else {
      setErrors((p) => ({ ...p, email: undefined }));
    }
  }

  function blurPhone() {
    const msg = validateNationalPhone(phoneCountryId, phoneNationalDigits);
    if (msg) {
      setErrors((p) => ({ ...p, phone: msg }));
    } else {
      setErrors((p) => ({ ...p, phone: undefined }));
    }
  }

  function blurPassword() {
    const msg = getPasswordRegistrationError(password);
    if (msg) {
      setErrors((p) => ({ ...p, password: msg }));
    } else {
      setErrors((p) => ({ ...p, password: undefined }));
    }
    if (confirm.length > 0) {
      blurConfirmMatchOnly();
    }
  }

  function blurConfirmMatchOnly() {
    if (!passwordsMatch(password, confirm)) {
      setErrors((p) => ({ ...p, confirm: 'Las contraseñas no coinciden.' }));
    } else {
      setErrors((p) => ({ ...p, confirm: undefined }));
    }
  }

  function blurConfirm() {
    const pwdErr = getPasswordRegistrationError(password);
    if (pwdErr) {
      setErrors((p) => ({ ...p, password: pwdErr, confirm: undefined }));
      return;
    }
    blurConfirmMatchOnly();
  }

  async function pickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Necesitamos acceso a tu galería para subir tu foto de perfil.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setAvatarUri(result.assets[0].uri);
    }
  }

  async function pickTradePhoto(tradeId: string) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Necesitamos acceso a tu galería para subir una foto de respaldo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setTrades((prev) =>
        prev.map((t) => (t.id === tradeId ? { ...t, proofImageUri: result.assets[0].uri } : t)),
      );
    }
  }

  function addTradeBlock() {
    if (trades.length >= 5) return;
    const id = `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const next: WorkerTradeDraft = {
      id,
      name: getDefaultRubroNombre() || 'Albañilería',
      details: '',
    };
    setTrades((prev) => {
      const merged = [...prev, next];
      if (!primaryTradeId) setPrimaryTradeId(merged[0]?.id ?? null);
      return merged;
    });
    if (!primaryTradeId) setPrimaryTradeId(id);
  }

  function removeTradeBlock(id: string) {
    setTrades((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (primaryTradeId === id) {
        setPrimaryTradeId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  function updateTrade(id: string, patch: Partial<WorkerTradeDraft>) {
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  const activeTrade = useMemo(
    () => (tradePickerOpenForId ? trades.find((t) => t.id === tradePickerOpenForId) ?? null : null),
    [tradePickerOpenForId, trades],
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
      // Mapeo a nuestro GeoPoint
      const mapped: GeoPoint[] = suggestions.map((s) => ({
        address: s.address,
        lat: s.lat,
        lng: s.lng,
      }));
      setAddressResults(mapped);
    } finally {
      if (reqId === requestIdRef.current) setSearching(false);
    }
  }

  // Autocomplete con debounce
  useEffect(() => {
    const q = addressQuery.trim();
    const t = setTimeout(() => {
      void runGeocode(q);
    }, 450);
    return () => clearTimeout(t);
  }, [addressQuery]);

  const coverageMeters = offerServices ? clampInt(Number(coverageKm) || 0, 1, 300) * 1000 : 0;

  async function runReverseGeocode(lat: number, lng: number) {
    const reqId = ++reverseReqRef.current;
    try {
      const addr = await reverseNominatimStreet(lat, lng);
      if (reqId !== reverseReqRef.current) return;
      if (!addr) return;
      setGeo((prev) => (prev ? { ...prev, address: addr, lat, lng } : { address: addr, lat, lng }));
      setAddressQuery(addr);
    } catch {
      // silencioso: si Nominatim falla, mantenemos coords
    }
  }

  async function locateMe() {
    setLocationHint(null);
    setLocating(true);
    try {
      const res = await getHighAccuracyPosition();
      if (!res.ok) {
        if (res.reason === 'denied') {
          setLocationHint('Para una mejor experiencia, por favor permite el acceso a tu ubicación');
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

  useEffect(() => {
    // Al montar: intentamos ubicación precisa (no por IP)
    void locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validate(): boolean {
    const next: DraftErrors = {};

    if (!firstName.trim()) next.firstName = 'El nombre es obligatorio.';
    if (!lastName.trim()) next.lastName = 'El apellido es obligatorio.';

    const dniDigits = normalizeDigitsOnly(dni);
    if (!dniDigits) next.dni = 'El DNI es obligatorio.';
    else if (dniDigits.length < 7 || dniDigits.length > 9) next.dni = 'Ingresá un DNI válido.';

    if (!avatarUri) next.avatar = 'La foto de perfil es obligatoria.';

    if (!email.trim()) next.email = 'El email es obligatorio.';
    else if (!isValidEmail(email)) next.email = 'Ingresá un email válido (ej. nombre@ejemplo.com).';

    const phoneErr = validateNationalPhone(phoneCountryId, phoneNationalDigits);
    if (phoneErr) next.phone = phoneErr;

    if (bio.trim().length > MAX_BIO_LEN) {
      next.bio = `Máximo ${MAX_BIO_LEN} caracteres.`;
    }

    const pwdErr = getPasswordRegistrationError(password);
    if (pwdErr) next.password = pwdErr;
    if (!passwordsMatch(password, confirm)) next.confirm = 'Las contraseñas no coinciden.';

    if (!geo) next.location = 'Seleccioná una dirección para obtener latitud/longitud.';

    if (offerServices) {
      const km = clampInt(Number(coverageKm) || 0, 1, 300);
      if (!Number.isFinite(Number(coverageKm)) || km < 1) {
        next.coverageKm = 'Ingresá un radio válido (mínimo 1 km).';
      }

      if (trades.length < 1) next.trades = 'Agregá al menos 1 oficio.';
      if (trades.length > 5) next.trades = 'Máximo 5 oficios.';

      const hasEmptyTrade = trades.some((t) => !t.name?.trim());
      if (hasEmptyTrade) next.trades = 'Cada oficio debe tener un nombre.';

      const uniqueNames = new Set(trades.map((t) => t.name.trim()));
      if (uniqueNames.size !== trades.length) next.trades = 'No repitas el mismo oficio.';

      if (!primaryTradeId || !trades.some((t) => t.id === primaryTradeId)) {
        next.trades = 'Marcá un oficio principal.';
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!termsAccepted) {
      setTermsOpen(true);
      return;
    }
    if (!validate()) return;
    if (!geo || !avatarUri) return;

    setLoading(true);
    try {
      const result = await signUp({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dni: normalizeDigitsOnly(dni),
        avatarUri,
        email: email.trim(),
        phone: buildInternationalPhoneDisplay(
          selectedPhoneCountry.dial,
          selectedPhoneCountry.id,
          phoneNationalDigits,
        ),
        password,
        bio: bio.trim() || undefined,
        baseLocation: geo,
        offerServices,
        coverageKm: offerServices ? clampInt(Number(coverageKm) || 0, 1, 300) : undefined,
        trades: offerServices ? trades : undefined,
        primaryTradeId: offerServices ? primaryTradeId ?? undefined : undefined,
      });

      if (!result.ok) {
        Alert.alert('Error', result.message);
        return;
      }
      setFlashMessage('¡Cuenta creada! Bienvenido/a a Tu Changa.');
      await signIn(result.user, true);
      closeAuthModalAndGoToInicio();
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { width: contentWidth }]}>
            <Text style={styles.title}>Crear cuenta</Text>
            <Text style={styles.subtitle}>
              Perfil único: empezás como cliente y, si querés, activás funciones de trabajador.
            </Text>

            <Text style={styles.section}>Identidad</Text>
            <Pressable style={styles.avatarRow} onPress={pickAvatar} hitSlop={8}>
              <View style={styles.avatar}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                ) : (
                  <Ionicons name="person" size={28} color={colors.textSecondary} />
                )}
              </View>
              <View style={styles.avatarText}>
                <Text style={styles.avatarTitle}>Foto de perfil</Text>
                <Text style={styles.avatarHint}>
                  {avatarUri ? 'Tocá para cambiar' : 'Obligatoria'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </Pressable>
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
                  onBlur={blurFirstName}
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
                  onBlur={blurLastName}
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
              onBlur={blurDni}
              keyboardType="number-pad"
              placeholder="Ej.: 12345678"
              error={errors.dni}
            />

            <Text style={styles.section}>Contacto</Text>
            <AppTextInput
              label="Correo electrónico *"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setErrors((p) => ({ ...p, email: undefined }));
              }}
              onBlur={blurEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="nombre@ejemplo.com"
              error={errors.email}
            />

            <View style={styles.phoneBlock}>
              <Text style={styles.fieldLabelStatic}>Teléfono *</Text>
              <Text style={styles.phoneHint}>
                Solo números. Argentina (por defecto): +54 9 364 565566 — escribí 9 y tu número sin el
                54.
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
                    onBlur={blurPhone}
                    keyboardType="phone-pad"
                    placeholder={phoneCountryId === 'AR' ? '9 364 565566' : 'Número local'}
                    placeholderTextColor={colors.textSecondary}
                    autoCorrect={false}
                  />
                </View>
              </View>
              {errors.phone ? <Text style={styles.phoneError}>{errors.phone}</Text> : null}
            </View>

            <Text style={styles.section}>Presentación (opcional)</Text>
            <Text style={styles.hint}>
              Contá algo sobre vos. Se muestra en tu perfil (máximo {MAX_BIO_LEN} caracteres).
            </Text>
            <Text style={styles.fieldLabel}>Bio</Text>
            <TextInput
              style={[styles.textArea, errors.bio ? styles.textAreaError : null]}
              value={bio}
              onChangeText={(t) => {
                setBio(t.slice(0, MAX_BIO_LEN));
                setErrors((p) => ({ ...p, bio: undefined }));
              }}
              multiline
              placeholder="Ej.: Electricista matriculado, trabajo en zona norte…"
              placeholderTextColor={colors.textSecondary}
            />
            {errors.bio ? <Text style={styles.error}>{errors.bio}</Text> : null}
            <Text style={styles.bioCounter}>
              {bio.length}/{MAX_BIO_LEN}
            </Text>

            <Text style={styles.section}>Seguridad</Text>
            <AppTextInput
              label="Contraseña *"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setErrors((p) => ({ ...p, password: undefined }));
                if (confirm.length > 0 && passwordsMatch(t, confirm)) {
                  setErrors((p) => ({ ...p, confirm: undefined }));
                }
              }}
              onBlur={blurPassword}
              secureTextEntry
              placeholder="8+ caracteres, letra y número"
              error={errors.password}
            />
            <AppTextInput
              label="Confirmar contraseña *"
              value={confirm}
              onChangeText={(t) => {
                setConfirm(t);
                setErrors((p) => ({ ...p, confirm: undefined }));
              }}
              onBlur={blurConfirm}
              secureTextEntry
              placeholder="Repetí la contraseña"
              error={errors.confirm}
            />

            <Text style={styles.section}>Ubicación base *</Text>
            <Text style={styles.hint}>
              Buscá tu dirección y elegí una sugerencia para guardar latitud/longitud. Si no queda
              exacto, mové el pin manualmente.
            </Text>
            {locationHint ? <Text style={styles.hintWarn}>{locationHint}</Text> : null}
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrap}>
                <TextInput
                  style={styles.searchInput}
                  value={addressQuery}
                  onChangeText={(t) => {
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
                {addressResults.map((r) => (
                  <Pressable
                    key={`${r.lat}-${r.lng}-${r.address}`}
                    style={styles.resultRow}
                    onPress={() => {
                      setGeo(r);
                      setAddressResults([]);
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
                showCoverage={offerServices}
                locating={locating}
                onLocateMe={() => void locateMe()}
                onPinMoved={(lat: number, lng: number) => {
                  setGeo((prev) => (prev ? { ...prev, lat, lng } : { address: '', lat, lng }));
                  const id = ++reverseReqRef.current;
                  setTimeout(() => {
                    if (id !== reverseReqRef.current) return;
                    void runReverseGeocode(lat, lng);
                  }, 550);
                }}
              />
            ) : null}

            <View style={styles.toggleCard}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.toggleTitle}>Quiero ofrecer mis servicios en la plataforma</Text>
                <Text style={styles.toggleHint}>
                  Activá esto si además querés aparecer en búsquedas como trabajador.
                </Text>
              </View>
              <Switch
                value={offerServices}
                onValueChange={(v) => {
                  setOfferServices(v);
                  if (!v) {
                    setTrades([]);
                    setPrimaryTradeId(null);
                    setCoverageKm('10');
                    setErrors((prev) => ({ ...prev, coverageKm: undefined, trades: undefined }));
                  } else if (trades.length === 0) {
                    addTradeBlock();
                  }
                }}
                trackColor={{ false: '#D1D5DB', true: '#FCA5A5' }}
                thumbColor={offerServices ? colors.primary : '#F3F4F6'}
              />
            </View>

            {offerServices ? (
              <View style={styles.workerWrap}>
                <Text style={styles.section}>Radio de cobertura</Text>
                <Text style={styles.hint}>
                  Definí tu alcance en km desde tu ubicación base.
                </Text>
                <View style={styles.coverRow}>
                  <TextInput
                    style={styles.coverInput}
                    value={coverageKm}
                    onChangeText={(t) => setCoverageKm(normalizeDigitsOnly(t).slice(0, 3))}
                    keyboardType="number-pad"
                    placeholder="10"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Text style={styles.coverUnit}>km</Text>
                </View>
                {errors.coverageKm ? <Text style={styles.error}>{errors.coverageKm}</Text> : null}

                <View style={styles.tradesHeader}>
                  <Text style={styles.section}>Oficios</Text>
                  <Text style={styles.tradesCount}>
                    {trades.length}/5
                  </Text>
                </View>
                <Text style={styles.hint}>
                  Mínimo 1 oficio. Elegí uno como principal (se usa para listados rápidos).
                </Text>
                {errors.trades ? <Text style={styles.error}>{errors.trades}</Text> : null}

                {trades.map((t) => (
                  <View key={t.id} style={styles.tradeCard}>
                    <View style={styles.tradeTopRow}>
                      <Pressable
                        style={styles.radio}
                        onPress={() => setPrimaryTradeId(t.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: primaryTradeId === t.id }}
                      >
                        <View
                          style={[
                            styles.radioOuter,
                            primaryTradeId === t.id && styles.radioOuterActive,
                          ]}
                        >
                          {primaryTradeId === t.id ? <View style={styles.radioInner} /> : null}
                        </View>
                        <Text style={styles.radioLabel}>Principal</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => removeTradeBlock(t.id)}
                        hitSlop={10}
                        disabled={trades.length <= 1}
                        style={[
                          styles.iconBtn,
                          trades.length <= 1 && styles.iconBtnDisabled,
                        ]}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
                      </Pressable>
                    </View>

                    <Text style={styles.fieldLabel}>Oficio</Text>
                    <Pressable
                      style={styles.dropdown}
                      onPress={() => setTradePickerOpenForId(t.id)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.dropdownText} numberOfLines={2}>
                        {t.name}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                    </Pressable>

                    <Text style={styles.fieldLabel}>Detalles / experiencia</Text>
                    <TextInput
                      style={styles.textArea}
                      value={t.details}
                      onChangeText={(txt) => updateTrade(t.id, { details: txt })}
                      placeholder="Contá tu experiencia, herramientas, especialidad…"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      maxLength={600}
                    />

                    <Text style={styles.fieldLabel}>Foto de respaldo</Text>
                    <Pressable
                      style={styles.photoRow}
                      onPress={() => void pickTradePhoto(t.id)}
                      hitSlop={8}
                    >
                      <View style={styles.photoThumb}>
                        {t.proofImageUri ? (
                          <Image source={{ uri: t.proofImageUri }} style={styles.photoThumbImg} />
                        ) : (
                          <Ionicons name="image-outline" size={22} color={colors.textSecondary} />
                        )}
                      </View>
                      <View style={styles.photoText}>
                        <Text style={styles.photoTitle}>
                          {t.proofImageUri ? 'Cambiar foto' : 'Subir foto'}
                        </Text>
                        <Text style={styles.photoHint}>Opcional (por oficio)</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                ))}

                <AppButton
                  title="+ Agregar oficio"
                  onPress={addTradeBlock}
                  disabled={trades.length >= 5}
                  style={styles.addTradeButton}
                />
              </View>
            ) : null}

            <AppButton
              title="Crear cuenta"
              onPress={handleSubmit}
              loading={loading}
              style={styles.submitButton}
            />

            <View style={styles.termsRow}>
              <Text style={styles.termsText}>Al crear tu cuenta, aceptás los </Text>
              <TextLink inline onPress={() => setTermsOpen(true)}>
                Términos y Condiciones
              </TextLink>
              <Text style={styles.termsText}>.</Text>
            </View>

            <View style={styles.footerRow}>
              <Text style={styles.muted}>¿Ya tenés cuenta? </Text>
              <TextLink inline onPress={() => navigation.navigate('Login')}>
                Ingresar
              </TextLink>
            </View>
          </View>
        </ScrollView>

        <TradeSearchModal
          visible={Boolean(tradePickerOpenForId)}
          title="Elegí un oficio"
          initialNombre={activeTrade?.name ?? null}
          onClose={() => setTradePickerOpenForId(null)}
          onApply={(picked) => {
            if (!tradePickerOpenForId) return;
            if (!picked) {
              updateTrade(tradePickerOpenForId, { name: '', rubroSlug: undefined });
              return;
            }
            updateTrade(tradePickerOpenForId, {
              name: picked.nombre,
              rubroSlug: picked.slug,
            });
          }}
        />

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

        <TermsAndConditionsModal
          visible={termsOpen}
          onClose={() => setTermsOpen(false)}
          onAccept={() => {
            setTermsAccepted(true);
            setTermsOpen(false);
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'center',
    paddingTop: spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.xs,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  section: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    letterSpacing: -0.2,
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
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  hintSmall: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 10,
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
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
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
  phoneCountryBtnError: {
    borderColor: colors.error,
  },
  phoneCountryDial: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  phoneInputWrap: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  phoneInputWrapError: {
    borderColor: colors.error,
  },
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
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
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginTop: spacing.sm,
  },
  dropdownText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginRight: spacing.sm,
  },
  results: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resultText: { flex: 1 },
  resultTitle: { fontSize: 14, fontWeight: '800', color: colors.text, lineHeight: 20 },
  resultHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  geoPill: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  geoText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  toggleCard: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  toggleTextWrap: { flex: 1, marginRight: spacing.md },
  toggleTitle: { fontSize: 15, fontWeight: '900', color: colors.text, lineHeight: 20 },
  toggleHint: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  workerWrap: { marginTop: spacing.sm },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverInput: {
    width: 92,
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  coverUnit: { fontSize: 16, fontWeight: '800', color: colors.textSecondary },
  tradesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tradesCount: { fontSize: 13, fontWeight: '800', color: colors.textSecondary },
  tradeCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tradeTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  radio: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  radioLabel: { fontSize: 13, fontWeight: '900', color: colors.textSecondary },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDisabled: { opacity: 0.45 },
  fieldLabel: { marginTop: spacing.md, fontSize: 13, fontWeight: '900', color: colors.text },
  textArea: {
    marginTop: spacing.sm,
    minHeight: 96,
    backgroundColor: colors.background,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  textAreaError: {
    borderColor: colors.error,
  },
  bioCounter: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  photoRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  photoThumb: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoThumbImg: { width: '100%', height: '100%' },
  photoText: { flex: 1, marginLeft: spacing.md },
  photoTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  photoHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  addTradeButton: {
    marginTop: spacing.md,
  },
  submitButton: {
    marginTop: spacing.lg,
  },
  termsRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  muted: {
    color: colors.textSecondary,
    fontSize: 15,
  },
});
