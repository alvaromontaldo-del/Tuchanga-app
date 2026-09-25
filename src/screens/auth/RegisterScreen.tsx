import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ensureGalleryPermission, ensureCameraPermission } from '../../utils/mediaPermissions';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Image,
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { AppScreen } from '../../components/layout/AppScreen';
import { BrandLogoHorizontal } from '../../components/brand/BrandMark';
import { AppButton } from '../../components/common/AppButton';
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { AppTextInput } from '../../components/common/AppTextInput';
import { ModeratedTextField } from '../../components/common/ModeratedTextField';
import { LocationMap } from '../../components/location/LocationMap';
import { SingleSelectModal } from '../../components/common/SingleSelectModal';
import { TradeSearchModal } from '../../components/search/TradeSearchModal';
import { TextLink } from '../../components/common/TextLink';
import { TermsAndConditionsModal } from '../../components/legal/TermsAndConditionsModal';
import { useAppToast } from '../../components/toast/toast';
import { fetchNominatimSuggestions, reverseNominatimStreet } from '../../config/nominatim';
import { addressFromPick, addressToPersist, retainHouseNumber } from '../../utils/streetAddressQuery';
import {
  DEFAULT_PHONE_COUNTRY_ID,
  getPhoneCountryById,
  PHONE_COUNTRIES,
  phoneCountryLabel,
} from '../../data/phoneCountries';
import { getDefaultRubroNombre } from '../../data/rubrosCatalog';
import type { AuthStackScreenProps } from '../../navigation/types';
import { signUp, type WorkerTradeDraft, MSG_IDENTITY_FIELD, checkIdentityConflicts } from '../../services/auth';
import {
  buildInternationalPhoneDisplay,
  formatArgentinaNationalSpacing,
  getPasswordRegistrationError,
  isValidEmail,
  passwordsMatch,
  sanitizeNationalPhoneDigits,
  validateNationalPhone,
} from '../../utils/validation';
import {
  CONTACT_MODERATION_PROFILE_FIELD_MESSAGE,
  validateContactInfo,
  validateWorkerProfileTexts,
} from '../../utils/contactModeration';
import {
  birthDateIsoFromDate,
  calcAgeFromBirthDate,
  dateFromBirthDateIso,
  formatBirthDateDisplay,
  parseBirthDateParts,
} from '../../utils/birthDate';
import { colors, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useCommerceShell } from '../../context/CommerceShellContext';
import { closeAuthModalAndGoToInicio, closeAuthModalAndRedirect } from '../../navigation/openAuthModal';
import {
  fetchStoreRubrosCatalog,
  registerMyStore,
} from '../../services/storeRegistrationSupabase';
import { StoreOpeningHoursEditor } from '../../components/store/StoreOpeningHoursEditor';
import {
  defaultStoreOpeningHours,
  type StoreHoursSlot,
} from '../../utils/storeOpeningHours';
import type { StoreRubro } from '../../types/materials';
import { getHighAccuracyPosition } from '../../utils/deviceGeolocation';
import { normalizeLocalImageUri } from '../../utils/normalizeLocalImage';

type Props = AuthStackScreenProps<'Register'>;

type GeoPoint = { lat: number; lng: number; address: string };

type DraftErrors = Partial<Record<
  | 'firstName'
  | 'lastName'
  | 'dni'
  | 'avatar'
  | 'birthDate'
  | 'email'
  | 'phone'
  | 'password'
  | 'confirm'
  | 'location'
  | 'professionalDescription'
  | 'coverageKm'
  | 'trades'
  | 'storeName'
  | 'storeRubros',
  string
>>;

const MAX_PROFESSIONAL_DESCRIPTION_LEN = 500;
const MIN_PROFESSIONAL_DESCRIPTION_LEN = 20;

function normalizeDigitsOnly(input: string) {
  return input.replace(/[^0-9]/g, '');
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function RegisterScreen({ navigation, route }: Props) {
  const { signIn, setFlashMessage, flashMessage } = useAuth();
  const { enterCommerceIntent, chooseSessionRole, refresh: refreshCommerceShell } =
    useCommerceShell();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width - spacing.lg * 2, 520);
  const toast = useAppToast();
  const redirectTo = route.params?.redirectTo;
  const asCommerce = Boolean(route.params?.asCommerce);

  useEffect(() => {
    if (!flashMessage) return;
    toast.info(flashMessage, 'YaChanga');
    setFlashMessage(null);
  }, [flashMessage, setFlashMessage, toast]);

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
  const [birthDate, setBirthDate] = useState('');
  const [birthPickerOpen, setBirthPickerOpen] = useState(false);
  const [birthPickerDraft, setBirthPickerDraft] = useState<Date>(new Date(2000, 0, 1, 12, 0, 0, 0));
  const [email, setEmail] = useState('');
  const [phoneNationalDigits, setPhoneNationalDigits] = useState('');
  const [phoneCountryId, setPhoneCountryId] = useState(DEFAULT_PHONE_COUNTRY_ID);
  const [phoneCountryPickerOpen, setPhoneCountryPickerOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  /** Obligatorio solo si ofrece servicios; se guarda como bio en el perfil. */
  const [professionalDescription, setProfessionalDescription] = useState('');

  // Alta comercio (solo asCommerce)
  const [storeName, setStoreName] = useState('');
  const [storeRubros, setStoreRubros] = useState<StoreRubro[]>([]);
  const [selectedStoreRubros, setSelectedStoreRubros] = useState<string[]>([]);
  const [storeOpeningHours, setStoreOpeningHours] = useState<StoreHoursSlot[]>(
    defaultStoreOpeningHours(),
  );
  const [storeRubrosLoading, setStoreRubrosLoading] = useState(false);

  // Ubicación base
  const [addressQuery, setAddressQuery] = useState('');
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [locationDetails, setLocationDetails] = useState('');
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
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  const [devicePos, setDevicePos] = useState<{ lat: number; lng: number } | null>(null);

  // Modo trabajador
  const [offerServices, setOfferServices] = useState(false);
  const [coverageKm, setCoverageKm] = useState('10');
  const [trades, setTrades] = useState<WorkerTradeDraft[]>([]);
  const [primaryTradeId, setPrimaryTradeId] = useState<string | null>(null);
  const [tradePickerOpenForId, setTradePickerOpenForId] = useState<string | null>(null);

  useEffect(() => {
    if (!asCommerce) return;
    void enterCommerceIntent();
    setOfferServices(false);
    setTrades([]);
    setPrimaryTradeId(null);
    setCoverageKm('10');
    setProfessionalDescription('');
  }, [asCommerce, enterCommerceIntent]);

  useEffect(() => {
    if (!asCommerce) return;
    let cancelled = false;
    setStoreRubrosLoading(true);
    void (async () => {
      try {
        const list = await fetchStoreRubrosCatalog();
        if (!cancelled) setStoreRubros(list);
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : 'No se pudieron cargar los rubros.',
            'Rubros',
          );
          setStoreRubros([]);
        }
      } finally {
        if (!cancelled) setStoreRubrosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asCommerce, toast]);

  const workerContactModeration = useMemo(
    () =>
      validateWorkerProfileTexts(
        professionalDescription,
        trades.map((t) => t.details ?? ''),
      ),
    [professionalDescription, trades],
  );

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
      return;
    }
    if (dniDigits.length < 7 || dniDigits.length > 8) {
      setErrors((p) => ({ ...p, dni: 'El DNI debe tener 7 u 8 dígitos.' }));
      return;
    }
    setErrors((p) => ({ ...p, dni: undefined }));
    void (async () => {
      const conflict = await checkIdentityConflicts({ dni: dniDigits });
      if (conflict?.field === 'dni') {
        setErrors((p) => ({ ...p, dni: MSG_IDENTITY_FIELD.dni }));
      }
    })();
  }

  function blurBirthDate() {
    const t = birthDate.trim();
    if (!t) {
      setErrors((p) => ({ ...p, birthDate: 'La fecha de nacimiento es obligatoria.' }));
      return;
    }
    if (!parseBirthDateParts(t)) {
      setErrors((p) => ({ ...(p as any), birthDate: 'Formato esperado: AAAA-MM-DD.' }));
      return;
    }
    const age = calcAgeFromBirthDate(t);
    if (age == null) {
      setErrors((p) => ({ ...(p as any), birthDate: 'Ingresá una fecha válida.' }));
      return;
    }
    if (age < 18) {
      setErrors((p) => ({ ...(p as any), birthDate: 'Debés ser mayor de 18 años.' }));
      return;
    }
    setErrors((p) => ({ ...(p as any), birthDate: undefined }));
  }

  function blurEmail() {
    const t = email.trim();
    if (!t) {
      setErrors((p) => ({ ...p, email: 'El email es obligatorio.' }));
      return;
    }
    if (!isValidEmail(t)) {
      setErrors((p) => ({ ...p, email: 'Ingresá un email válido (ej. nombre@ejemplo.com).' }));
      return;
    }
    setErrors((p) => ({ ...p, email: undefined }));
    void (async () => {
      const conflict = await checkIdentityConflicts({ email: t.toLowerCase() });
      if (conflict?.field === 'email') {
        setErrors((p) => ({ ...p, email: MSG_IDENTITY_FIELD.email }));
      }
    })();
  }

  function blurPhone() {
    const msg = validateNationalPhone(phoneCountryId, phoneNationalDigits);
    if (msg) {
      setErrors((p) => ({ ...p, phone: msg }));
      return;
    }
    setErrors((p) => ({ ...p, phone: undefined }));
    const phone = buildInternationalPhoneDisplay(
      selectedPhoneCountry.dial,
      selectedPhoneCountry.id,
      phoneNationalDigits,
    );
    void (async () => {
      const conflict = await checkIdentityConflicts({ phone });
      if (conflict?.field === 'phone') {
        setErrors((p) => ({ ...p, phone: MSG_IDENTITY_FIELD.phone }));
      }
    })();
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

  async function applyAvatarUri(uri: string) {
    try {
      const stable = await normalizeLocalImageUri(uri, { squareCrop: true });
      setAvatarUri(stable);
      setErrors((p) => ({ ...p, avatar: undefined }));
    } catch {
      toast.warning('No se pudo procesar la foto. Probá de nuevo o elegí otra.', 'Foto');
    }
  }

  async function pickAvatarFromGallery() {
    const okGallery = await ensureGalleryPermission();
    if (!okGallery) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      await applyAvatarUri(result.assets[0].uri);
    }
  }

  async function pickAvatarFromCamera() {
    const okCamera = await ensureCameraPermission();
    if (!okCamera) {
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      // En Android el crop nativo de cámara es inestable; normalizamos después.
      allowsEditing: Platform.OS === 'ios',
      aspect: [1, 1],
      quality: 0.9,
      exif: false,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      await applyAvatarUri(result.assets[0].uri);
    }
  }

  function pickAvatar() {
    Alert.alert('Foto de perfil', '¿Cómo querés cargar tu foto?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Tomar foto (Cámara)', onPress: () => void pickAvatarFromCamera() },
      { text: 'Elegir de la galería', onPress: () => void pickAvatarFromGallery() },
    ]);
  }

  async function pickTradePhoto(tradeId: string) {
    const okGallery = await ensureGalleryPermission();
    if (!okGallery) {
      return;
    }
    const current =
      trades.find((t) => t.id === tradeId)?.proofImageUris?.length
        ? (trades.find((t) => t.id === tradeId)!.proofImageUris as string[])
        : trades.find((t) => t.id === tradeId)?.proofImageUri
          ? [trades.find((t) => t.id === tradeId)!.proofImageUri as string]
          : [];
    const left = Math.max(0, 5 - current.length);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, Math.min(5, left || 5)),
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled) return;
    const picked = (result.assets ?? []).map((a) => a.uri).filter(Boolean).slice(0, 5);
    if (picked.length === 0) return;
    const next = [...current, ...picked].filter(Boolean).slice(0, 5);
    setTrades((prev) =>
      prev.map((t) =>
        t.id === tradeId ? { ...t, proofImageUri: next[0], proofImageUris: next } : t,
      ),
    );
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
    } catch {
      if (reqId === requestIdRef.current) setAddressResults([]);
    } finally {
      if (reqId === requestIdRef.current) setSearching(false);
    }
  }

  // Autocomplete con debounce
  useEffect(() => {
    const q = addressQuery.trim();
    if (skipGeocodeRef.current === q) {
      skipGeocodeRef.current = null;
      return;
    }
    const t = setTimeout(() => {
      void runGeocode(q);
    }, 450);
    return () => clearTimeout(t);
  }, [addressQuery]);

  const coverageMeters = asCommerce
    ? 0
    : offerServices
      ? clampInt(Number(coverageKm) || 0, 1, 300) * 1000
      : 0;

  async function runReverseGeocode(lat: number, lng: number) {
    const reqId = ++reverseReqRef.current;
    try {
      const addr = await reverseNominatimStreet(lat, lng);
      if (reqId !== reverseReqRef.current) return;
      if (!addr) return;
      if (!pinMovedRef.current && confirmedLabelRef.current) return;
      const source = typedQueryRef.current || selectedAddressRef.current || '';
      const kept = source ? retainHouseNumber(source, addr) : addr;
      selectedAddressRef.current = kept;
      skipGeocodeRef.current = kept;
      setGeo((prev) => (prev ? { ...prev, address: kept, lat, lng } : { address: kept, lat, lng }));
      setAddressQuery(kept);
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
      selectedAddressRef.current = null;
      typedQueryRef.current = null;
      confirmedLabelRef.current = null;
      pinMovedRef.current = false;
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
    else if (dniDigits.length < 7 || dniDigits.length > 8) {
      next.dni = 'El DNI debe tener 7 u 8 dígitos.';
    }

    const bd = birthDate.trim();
    if (!bd) (next as any).birthDate = 'La fecha de nacimiento es obligatoria.';
    else if (!parseBirthDateParts(bd)) (next as any).birthDate = 'Formato esperado: AAAA-MM-DD.';
    else {
      const age = calcAgeFromBirthDate(bd);
      if (age == null) (next as any).birthDate = 'Ingresá una fecha válida.';
      else if (age < 18) (next as any).birthDate = 'Debés ser mayor de 18 años.';
    }

    if (!avatarUri) next.avatar = 'La foto de perfil es obligatoria.';

    if (!email.trim()) next.email = 'El email es obligatorio.';
    else if (!isValidEmail(email)) next.email = 'Ingresá un email válido (ej. nombre@ejemplo.com).';
    else if (errors.email === MSG_IDENTITY_FIELD.email) next.email = MSG_IDENTITY_FIELD.email;

    const phoneErr = validateNationalPhone(phoneCountryId, phoneNationalDigits);
    if (phoneErr) next.phone = phoneErr;
    else if (errors.phone === MSG_IDENTITY_FIELD.phone) next.phone = MSG_IDENTITY_FIELD.phone;

    const dniDigitsCheck = normalizeDigitsOnly(dni);
    if (dniDigitsCheck && errors.dni === MSG_IDENTITY_FIELD.dni) next.dni = MSG_IDENTITY_FIELD.dni;

    const pwdErr = getPasswordRegistrationError(password);
    if (pwdErr) next.password = pwdErr;
    if (!passwordsMatch(password, confirm)) next.confirm = 'Las contraseñas no coinciden.';

    if (!geo) next.location = 'Seleccioná una dirección para obtener latitud/longitud.';

    if (asCommerce) {
      if (!storeName.trim()) next.storeName = 'El nombre del comercio es obligatorio.';
      if (selectedStoreRubros.length === 0) {
        next.storeRubros = 'Seleccioná al menos un rubro.';
      }
    }

    if (offerServices) {
      const desc = professionalDescription.trim();
      if (desc.length < MIN_PROFESSIONAL_DESCRIPTION_LEN) {
        next.professionalDescription = `La descripción profesional es obligatoria (mínimo ${MIN_PROFESSIONAL_DESCRIPTION_LEN} caracteres).`;
      } else if (desc.length > MAX_PROFESSIONAL_DESCRIPTION_LEN) {
        next.professionalDescription = `Máximo ${MAX_PROFESSIONAL_DESCRIPTION_LEN} caracteres.`;
      } else if (validateContactInfo(professionalDescription).blocked) {
        next.professionalDescription = CONTACT_MODERATION_PROFILE_FIELD_MESSAGE;
      }

      const blockedTrade = trades.findIndex((t) => validateContactInfo(t.details ?? '').blocked);
      if (blockedTrade >= 0) {
        next.trades = CONTACT_MODERATION_PROFILE_FIELD_MESSAGE;
      }

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
    if (!validate()) {
      toast.error('Revisá los campos marcados en rojo.', 'Faltan datos', { durationMs: 3500 });
      return;
    }

    if (!geo || !avatarUri) {
      toast.error('Completá la foto de perfil y la ubicación para continuar.', 'Faltan datos', {
        durationMs: 3500,
      });
      return;
    }

    const phone = buildInternationalPhoneDisplay(
      selectedPhoneCountry.dial,
      selectedPhoneCountry.id,
      phoneNationalDigits,
    );
    const savedAddress = addressToPersist({
      typedQuery: typedQueryRef.current,
      confirmedLabel: confirmedLabelRef.current,
      currentLabel: geo.address,
      pinMoved: pinMovedRef.current,
    });
    const baseLocation = { address: savedAddress, lat: geo.lat, lng: geo.lng };

    setLoading(true);
    try {
      const wantWorker = asCommerce ? false : offerServices;
      const result = await signUp({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dni: normalizeDigitsOnly(dni),
        avatarUri,
        birthDate: birthDate.trim(),
        email: email.trim(),
        phone,
        password,
        bio: wantWorker ? professionalDescription.trim() : undefined,
        baseLocation,
        locationDetails: locationDetails.trim() || undefined,
        offerServices: wantWorker,
        coverageKm: wantWorker ? clampInt(Number(coverageKm) || 0, 1, 300) : undefined,
        trades: wantWorker ? trades : undefined,
        primaryTradeId: wantWorker ? primaryTradeId ?? undefined : undefined,
      });

      if (!result.ok) {
        if (result.reason === 'email_confirmation') {
          toast.success(result.message, '¡Cuenta creada!', { durationMs: 5500 });
          navigation.navigate('Login', { asCommerce });
          return;
        }
        if (result.reason === 'identity_taken' || result.field) {
          const field = result.field;
          if (field) {
            setErrors((p) => ({
              ...p,
              [field]: MSG_IDENTITY_FIELD[field],
            }));
          }
          toast.error(result.message, 'No se pudo crear la cuenta', { durationMs: 5500 });
          return;
        }
        toast.error(result.message, 'No se pudo crear la cuenta', { durationMs: 4500 });
        return;
      }
      setFlashMessage(
        asCommerce
          ? '¡Cuenta creada! Tu comercio quedó pendiente de aprobación.'
          : '¡Cuenta creada! Bienvenido/a a YaChanga.',
      );
      await signIn(result.user, true);
      if (asCommerce) {
        await enterCommerceIntent();
        await chooseSessionRole('commerce');
        try {
          await registerMyStore({
            name: storeName.trim(),
            phone,
            address: savedAddress || storeName.trim(),
            latitude: geo.lat,
            longitude: geo.lng,
            rubroIds: selectedStoreRubros,
            openingHours: storeOpeningHours,
          });
          refreshCommerceShell();
        } catch (storeErr) {
          toast.warning(
            storeErr instanceof Error
              ? storeErr.message
              : 'La cuenta se creó, pero el alta del local quedó pendiente. Completala desde Cuenta comercio.',
            'Comercio',
            { durationMs: 6000 },
          );
        }
      }
      if (redirectTo && !asCommerce) closeAuthModalAndRedirect(redirectTo);
      else closeAuthModalAndGoToInicio();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppScreen style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <AppKeyboardAvoidingView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { width: contentWidth }]}>
            <View style={styles.brandWrap}>
              <BrandLogoHorizontal
                variant="register"
                maxWidth={contentWidth}
                style={styles.brandLogo}
              />
            </View>
            <Text style={styles.title}>
              {asCommerce ? 'Crear cuenta de comercio' : 'Crear cuenta'}
            </Text>
            <Text style={styles.subtitle}>
              {asCommerce
                ? 'Cargá los datos de tu local y del titular. El comercio queda pendiente de aprobación del admin.'
                : 'Perfil único: empezás como cliente y, si querés, activás funciones de trabajador.'}
            </Text>

            {asCommerce ? (
              <>
                <Text style={styles.section}>Datos del comercio</Text>
                <AppTextInput
                  label="Nombre del comercio *"
                  value={storeName}
                  onChangeText={(t) => {
                    setStoreName(t);
                    setErrors((p) => ({ ...p, storeName: undefined }));
                  }}
                  autoCapitalize="words"
                  placeholder="Ej. Ferretería El Tornillo"
                  maxLength={120}
                  error={errors.storeName}
                />
                <Text style={styles.fieldLabelStatic}>Rubros * (podés elegir varios)</Text>
                <Text style={styles.hint}>
                  Elegí los rubros en los que vas a cotizar materiales.
                </Text>
                {storeRubrosLoading ? (
                  <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
                ) : (
                  <View style={styles.rubroWrap}>
                    {storeRubros.map((r) => {
                      const on = selectedStoreRubros.includes(r.id);
                      return (
                        <Pressable
                          key={r.id}
                          onPress={() => {
                            setSelectedStoreRubros((prev) =>
                              prev.includes(r.id)
                                ? prev.filter((x) => x !== r.id)
                                : [...prev, r.id],
                            );
                            setErrors((p) => ({ ...p, storeRubros: undefined }));
                          }}
                          style={[styles.rubroChip, on && styles.rubroChipOn]}
                        >
                          <Text style={[styles.rubroChipText, on && styles.rubroChipTextOn]}>
                            {r.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {errors.storeRubros ? (
                  <Text style={styles.error}>{errors.storeRubros}</Text>
                ) : null}
                <StoreOpeningHoursEditor
                  slots={storeOpeningHours}
                  onChange={setStoreOpeningHours}
                />
              </>
            ) : null}

            <Text style={styles.section}>
              {asCommerce ? 'Titular de la cuenta' : 'Identidad'}
            </Text>
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
                setDni(normalizeDigitsOnly(t).slice(0, 8));
                setErrors((p) => ({ ...p, dni: undefined }));
              }}
              onBlur={blurDni}
              keyboardType="number-pad"
              maxLength={8}
              placeholder="Ej.: 12345678"
              error={errors.dni}
            />
            <View style={styles.birthWrap}>
              <Text style={styles.birthLabel}>Fecha de nacimiento *</Text>
              <Pressable
                onPress={() => {
                  setBirthPickerDraft(
                    dateFromBirthDateIso(birthDate) ?? new Date(2000, 0, 1, 12, 0, 0, 0),
                  );
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
                  placeholder="DD/MM/AAAA (18+)"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.birthInput}
                />
                <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              </Pressable>
              {errors.birthDate ? <Text style={styles.birthError}>{errors.birthDate}</Text> : null}
            </View>

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
              passwordToggle
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
              passwordToggle
              placeholder="Repetí la contraseña"
              error={errors.confirm}
            />

            <Text style={styles.section}>
              {asCommerce ? 'Dirección del local *' : 'Ubicación base *'}
            </Text>
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
                    selectedAddressRef.current = null;
                    typedQueryRef.current = null;
                    confirmedLabelRef.current = null;
                    pinMovedRef.current = false;
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
                      const typed = addressQuery;
                      const address = addressFromPick(typed, r.address);
                      typedQueryRef.current = typed;
                      confirmedLabelRef.current = address;
                      pinMovedRef.current = false;
                      selectedAddressRef.current = address;
                      reverseReqRef.current += 1;
                      skipGeocodeRef.current = address;
                      setAddressQuery(address);
                      setGeo({ ...r, address });
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
                showCoverage={!asCommerce && offerServices}
                locating={locating}
                onLocateMe={() => void locateMe()}
                onPinMoved={(lat: number, lng: number) => {
                  pinMovedRef.current = true;
                  setGeo((prev) => (prev ? { ...prev, lat, lng } : { address: '', lat, lng }));
                  const id = ++reverseReqRef.current;
                  setTimeout(() => {
                    if (id !== reverseReqRef.current) return;
                    void runReverseGeocode(lat, lng);
                  }, 550);
                }}
              />
            ) : null}

            <Text style={styles.section}>
              {asCommerce
                ? 'Detalles para ubicar el local'
                : 'Detalles para ubicar el domicilio'}
            </Text>
            <Text style={styles.hint}>
              {asCommerce
                ? 'Opcional. Referencias del local (entrada, entre calles, etc.).'
                : 'Opcional. Referencias para que el profesional te encuentre (rejas, color de fachada, etc.).'}
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

            {!asCommerce ? (
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
                    setProfessionalDescription('');
                    setErrors((prev) => ({
                      ...prev,
                      coverageKm: undefined,
                      trades: undefined,
                      professionalDescription: undefined,
                    }));
                  } else if (trades.length === 0) {
                    addTradeBlock();
                  }
                }}
                trackColor={{ false: '#D1D5DB', true: '#FCA5A5' }}
                thumbColor={offerServices ? colors.primary : '#F3F4F6'}
              />
            </View>
            ) : (
              <View style={styles.toggleCard}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Alta de comercio incluida</Text>
                  <Text style={styles.toggleHint}>
                    Con este formulario se crea la cuenta y se envía el local a revisión del admin.
                  </Text>
                </View>
                <Ionicons name="storefront-outline" size={28} color={colors.primary} />
              </View>
            )}

            {!asCommerce && offerServices ? (
              <View style={styles.workerWrap}>
                <Text style={styles.section}>Descripción profesional *</Text>
                <Text style={styles.hint}>
                  Contá quién sos como profesional, experiencia y qué ofrecés (mínimo{' '}
                  {MIN_PROFESSIONAL_DESCRIPTION_LEN} caracteres). Se muestra en tu perfil público.
                </Text>
                <ModeratedTextField
                  variant="plain"
                  showIcon={false}
                  policyMessage={CONTACT_MODERATION_PROFILE_FIELD_MESSAGE}
                  style={[
                    styles.textArea,
                    styles.workerFieldSurface,
                    errors.professionalDescription || workerContactModeration.professional.blocked
                      ? styles.textAreaError
                      : null,
                  ]}
                  value={professionalDescription}
                  onChangeText={(t) => {
                    setProfessionalDescription(t.slice(0, MAX_PROFESSIONAL_DESCRIPTION_LEN));
                    setErrors((p) => ({ ...p, professionalDescription: undefined }));
                  }}
                  multiline
                  textAlignVertical="top"
                  placeholder="Ej.: Electricista matriculado con 10 años de experiencia en instalaciones y reparaciones…"
                  placeholderTextColor={colors.textSecondary}
                />
                {errors.professionalDescription && !workerContactModeration.professional.blocked ? (
                  <Text style={styles.error}>{errors.professionalDescription}</Text>
                ) : null}
                <Text style={styles.summaryCounter}>
                  {professionalDescription.length}/{MAX_PROFESSIONAL_DESCRIPTION_LEN}
                </Text>

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

                {trades.map((t, tradeIdx) => (
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
                      style={[styles.dropdown, styles.workerFieldSurface]}
                      onPress={() => setTradePickerOpenForId(t.id)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.dropdownText} numberOfLines={2}>
                        {t.name}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                    </Pressable>

                    <Text style={styles.fieldLabel}>Detalles / experiencia</Text>
                    <ModeratedTextField
                      variant="plain"
                      showIcon={false}
                      policyMessage={CONTACT_MODERATION_PROFILE_FIELD_MESSAGE}
                      style={[
                        styles.textArea,
                        styles.workerFieldSurface,
                        workerContactModeration.tradeDescriptions[tradeIdx]?.blocked
                          ? styles.textAreaError
                          : null,
                      ]}
                      value={t.details}
                      onChangeText={(txt) => updateTrade(t.id, { details: txt })}
                      placeholder="Contá tu experiencia, herramientas, especialidad…"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      textAlignVertical="top"
                      maxLength={600}
                    />

                    <Text style={styles.fieldLabel}>Fotos del oficio (hasta 5)</Text>
                    <Pressable
                      style={[styles.photoRow, styles.workerFieldSurface]}
                      onPress={() => void pickTradePhoto(t.id)}
                      hitSlop={8}
                    >
                      <View style={styles.photoThumb}>
                        {t.proofImageUri ? (
                          <Image source={{ uri: t.proofImageUri }} style={styles.photoThumbImg} />
                        ) : (
                          <Ionicons name="images-outline" size={22} color={colors.textSecondary} />
                        )}
                      </View>
                      <View style={styles.photoText}>
                        <Text style={styles.photoTitle}>
                          {t.proofImageUri ? 'Agregar / cambiar' : 'Agregar fotos'}
                        </Text>
                        <Text style={styles.photoHint}>Opcional (mejora confianza)</Text>
                      </View>
                      {t.proofImageUri ? (
                        <Pressable
                          onPress={() =>
                            setTrades((prev) =>
                              prev.map((x) =>
                                x.id === t.id ? { ...x, proofImageUri: undefined, proofImageUris: undefined } : x,
                              ),
                            )
                          }
                          hitSlop={10}
                          accessibilityRole="button"
                          accessibilityLabel="Quitar fotos del oficio"
                        >
                          <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
                        </Pressable>
                      ) : (
                        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                      )}
                    </Pressable>

                    {(t.proofImageUris?.length ?? 0) > 1 ? (
                      <View style={styles.photoStrip}>
                        {t.proofImageUris!.map((u, i) => (
                          <View key={`${u}-${i}`} style={styles.photoMiniWrap}>
                            <Image source={{ uri: u }} style={styles.photoMini} />
                            <Pressable
                              onPress={() => {
                                const next = t.proofImageUris!.filter((_, j) => j !== i);
                                setTrades((prev) =>
                                  prev.map((x) =>
                                    x.id === t.id
                                      ? {
                                          ...x,
                                          proofImageUri: next[0],
                                          proofImageUris: next.length ? next : undefined,
                                        }
                                      : x,
                                  ),
                                );
                              }}
                              hitSlop={8}
                              style={styles.photoMiniRemove}
                              accessibilityRole="button"
                              accessibilityLabel="Quitar foto"
                            >
                              <Ionicons name="close-circle" size={18} color={colors.primary} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    ) : null}
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
              title={asCommerce ? 'Crear cuenta de comercio' : 'Crear cuenta'}
              onPress={handleSubmit}
              loading={loading}
              disabled={!asCommerce && offerServices && workerContactModeration.hasViolation}
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
              <TextLink
                inline
                onPress={() => navigation.navigate('Login', { asCommerce })}
              >
                Ingresar
              </TextLink>
            </View>
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
              // Algunos OEM no mandan type === 'set'; alcanza con selected.
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
                <View style={styles.pickerHeader}>
                  <Pressable
                    onPress={() => setBirthPickerOpen(false)}
                    style={({ pressed }) => [styles.pickerHeaderBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Cancelar"
                  >
                    <Text style={styles.pickerHeaderBtnText}>CANCELAR</Text>
                  </Pressable>
                  <Text style={styles.pickerTitle}>Fecha de nacimiento</Text>
                  <Pressable
                    onPress={() => {
                      const iso = birthDateIsoFromDate(birthPickerDraft);
                      setBirthDate(iso);
                      setErrors((p) => ({ ...p, birthDate: undefined }));
                      setBirthPickerOpen(false);
                    }}
                    style={({ pressed }) => [styles.pickerHeaderBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Aceptar"
                  >
                    <Text style={styles.pickerHeaderBtnText}>ACEPTAR</Text>
                  </Pressable>
                </View>
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
              </View>
            </View>
          </Modal>
        ) : null}

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
      </AppKeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  card: {
    alignSelf: 'center',
    paddingTop: 0,
  },
  brandWrap: {
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  brandLogo: {
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xs,
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
  rubroWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  rubroChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rubroChipOn: {
    borderColor: colors.primary,
    backgroundColor: '#FEE2E2',
  },
  rubroChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  rubroChipTextOn: {
    color: colors.primary,
  },
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
  workerFieldSurface: {
    backgroundColor: colors.surface,
  },
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
  summaryCounter: {
    alignSelf: 'flex-end',
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
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
  photoStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: spacing.sm,
  },
  photoMiniWrap: { width: 56, height: 56, borderRadius: 14, overflow: 'hidden' },
  photoMini: { width: '100%', height: '100%' },
  photoMiniRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.surface,
    borderRadius: 999,
  },
  addTradeButton: {
    marginTop: spacing.md,
  },
  submitButton: {
    marginTop: spacing.lg,
  },
  birthWrap: { marginBottom: spacing.sm },
  birthLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
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
  birthInputRowError: { borderColor: colors.error },
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
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  pickerHeaderBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.button,
  },
  pickerHeaderBtnText: { fontSize: 13, fontWeight: '900', color: colors.primary },
  pickerTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  pickerBodyIos: {
    height: 250,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.9 },
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
