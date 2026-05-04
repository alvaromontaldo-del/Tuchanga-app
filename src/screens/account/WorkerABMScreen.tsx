import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
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
import { AppKeyboardAvoidingView } from '../../components/common/AppKeyboardAvoidingView';
import { useAppToast } from '../../components/toast/toast';
import { TradeSearchModal } from '../../components/search/TradeSearchModal';
import { ImagePickerComponent } from '../../components/common/ImagePickerComponent';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import {
  type WorkerBaseLocation,
  type WorkerProfile,
  type WorkerTrade,
  useWorkerProfile,
} from '../../context/WorkerProfileContext';
import { useAuth } from '../../context/AuthContext';
import { useFeed } from '../../context/FeedContext';
import { useUserMode } from '../../context/UserModeContext';
import type { AccountStackScreenProps } from '../../navigation/accountTypes';
import {
  deactivateProfessionalProfileInSupabase,
  persistWorkerGeoToSupabase,
  persistWorkerJobsToSupabase,
  persistProfessionalDescriptionInSupabase,
} from '../../services/supabaseUser';
import { fetchSearchWorkerHitsFromSupabase } from '../../services/searchWorkersSupabase';
import type { AuthUser } from '../../services/auth';

type Props = AccountStackScreenProps<'WorkerABM'>;

/** Ubicación válida del perfil de cuenta (misma que búsqueda / registro). */
function profileBaseFromUser(user: AuthUser | null): WorkerBaseLocation | null {
  const b = user?.baseLocation;
  if (!b) return null;
  const addr = b.address?.trim() ?? '';
  if (addr.length < 4) return null;
  if (b.lat == null || b.lng == null || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    return null;
  }
  if (Math.abs(b.lat) < 1e-6 && Math.abs(b.lng) < 1e-6) return null;
  return { address: addr, lat: b.lat, lng: b.lng };
}

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
    yearsExperience: seed.yearsExperience ?? null,
    description: seed.description ?? '',
  };
}

type ValidationIssue = { field: string; scroll: string; msg: string };

function validateDetailed(
  trades: WorkerTrade[],
  professionalDescription: string,
  profileBase: WorkerBaseLocation | null,
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
    const y = t.yearsExperience == null ? null : Math.floor(Number(t.yearsExperience) || 0);
    if (y != null && (y < 1 || y > 50)) {
      issues.push({
        field: `trade_${i}_years`,
        scroll: `trade_${i}`,
        msg: 'Entre 1 y 50 años (o dejalo vacío).',
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

  if (!profileBase) {
    issues.push({
      field: 'location',
      scroll: 'coverage',
      msg: 'Cargá tu domicilio en Perfil → Editar datos de registro.',
    });
  }

  const rawKm = Number(coverageKmStr);
  if (!coverageKmStr.trim() || !Number.isFinite(rawKm) || rawKm < 1 || rawKm > 300) {
    issues.push({
      field: 'coverageKm',
      scroll: 'coverage',
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
  const { setWorkerTrade } = useUserMode();
  const { user, replaceOrMergeUser } = useAuth();
  const { refresh: refreshFeed } = useFeed();
  const toast = useAppToast();
  const userId = user?.id ?? null;

  const profileBase = useMemo(() => profileBaseFromUser(user), [user]);

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

  const [tradeModal, setTradeModal] = useState<{ idx: number } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const layoutYs = useRef<Record<string, number>>({});

  // Reset fuerte al cambiar de usuario (evita heredar estado del formulario entre cuentas).
  useEffect(() => {
    setSaving(false);
    setFieldErrors({});
    setDeleteBanner('');
    setTradeModal(null);
    setProfessionalDescription('');
    setTrades([newTrade({ isPrimary: true })]);
    setCoverageKm('10');
  }, [userId]);

  // Hidratar desde storage (perfil trabajador local) cuando esté disponible.
  useEffect(() => {
    if (!workerProfile) return;
    setCoverageKm(String(workerProfile.coverageKm));
    setProfessionalDescription(workerProfile.professionalDescription);
    setTrades(
      workerProfile.trades.length > 0 ? workerProfile.trades : [newTrade({ isPrimary: true })],
    );
  }, [workerProfile]);

  // Si todavía no hay perfil trabajador local, usar oficios/radio del servidor.
  useEffect(() => {
    if (workerProfile) return;
    if (user?.baseLocation?.lat == null || user.baseLocation.lng == null) return;
    setCoverageKm(String(user.worker?.coverageKm ?? 10));
    if (user.worker?.trades?.length) {
      setTrades(
        user.worker.trades.map((t) => ({
          id: t.id,
          name: t.name,
          isPrimary: Boolean(t.isPrimary),
          yearsExperience: 1,
          description: t.details ?? '',
        })),
      );
    }
  }, [workerProfile, user?.baseLocation?.lat, user?.baseLocation?.lng, user?.worker?.coverageKm, user?.worker?.trades]);

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
      toast.info('Todavía estamos guardando. Esperá un momento y probá de nuevo.', 'Guardado');
      return;
    }
    const { errors, scrollToKey: firstKey } = validateDetailed(
      trades,
      professionalDescription,
      profileBase,
      coverageKm,
    );
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setDeleteBanner('');
      const firstMsg = Object.values(errors)[0];
      toast.warning(
        firstMsg
          ? `Hay campos incompletos o inválidos.\n\n${firstMsg}`
          : 'Hay campos incompletos o inválidos. Revisá los marcados en rojo.',
        'Revisá tu perfil',
        { durationMs: 4200 },
      );
      scrollToKey(firstKey);
      return;
    }
    setFieldErrors({});
    setDeleteBanner('');
    setSaving(true);
    try {
      if (!user?.id) {
        toast.warning('Iniciá sesión para guardar tu perfil profesional.', 'Sesión');
        return;
      }
      const trimmedTrades = trades
        .map((t) => ({
          ...t,
          name: t.name.trim(),
          description: t.description.trim(),
          yearsExperience:
            t.yearsExperience == null || String(t.yearsExperience).trim() === ''
              ? null
              : Math.max(1, Math.min(50, Math.floor(Number(t.yearsExperience) || 0))),
        }))
        .filter((t) => t.name.length > 0)
        .slice(0, 5);

      const base = profileBaseFromUser(user);
      if (!base) {
        toast.warning(
          'Necesitamos tu domicilio guardado en el perfil. Andá a Perfil → Editar datos de registro y cargá la dirección.',
          'Ubicación',
          { durationMs: 4200 },
        );
        return;
      }

      const km = clampInt(Number(coverageKm) || 0, 1, 300);
      const profile: WorkerProfile = {
        professionalDescription: professionalDescription.trim(),
        baseLocation: {
          address: base.address.trim(),
          lat: base.lat,
          lng: base.lng,
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
          await persistProfessionalDescriptionInSupabase(profile.professionalDescription);
          if (user?.id) {
            await persistWorkerJobsToSupabase({
              userId: user.id,
              trades: trimmedTrades.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                yearsExperience: t.yearsExperience ?? null,
                proofImageUri: t.proofImageUri,
                proofImageUris: t.proofImageUris,
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
            toast.warning(
              'Tu perfil se guardó en el teléfono, pero todavía no aparece en la búsqueda del servidor. Revisá que Supabase tenga las migraciones `update_profile_geo_coverage` y `search_workers_for_client`, y que tu perfil tenga radio > 0 y al menos un oficio.',
              'Sincronización incompleta',
              { durationMs: 5200 },
            );
          }
        } catch (e) {
          toast.warning(
            `Guardamos en el dispositivo, pero no se pudo sincronizar el perfil profesional en el servidor.\n\n${
              e instanceof Error ? e.message : 'Error desconocido.'
            }\n\nRevisá la conexión o ejecutá las migraciones SQL (ubicación/radio y jobs) en Supabase.`,
            'Sincronización',
            { durationMs: 5200 },
          );
        }
      }

      const primary = trimmedTrades.find((t) => t.isPrimary) ?? trimmedTrades[0];
      if (primary?.name) setWorkerTrade(primary.name);

      // Reactividad: si reactivó el perfil, los posts pueden volver a verse por regla de "perfil activo".
      // Re-consultamos el feed para reflejarlo instantáneamente.
      try {
        await refreshFeed();
      } catch {
        /* ignore */
      }

      toast.success('Perfil profesional guardado.', 'Tu Changa');
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('MyAccount');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Ocurrió un error inesperado al guardar.',
        'No se pudo guardar',
        { durationMs: 4200 },
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    Alert.alert(
      'Dar de baja perfil profesional',
      '¿Seguro que querés dar de baja tu perfil profesional?\n\nVas a conservar tu cuenta y vas a poder seguir usando la app como cliente, pero dejarás de aparecer en búsquedas como trabajador.\n\nAdemás, tus publicaciones dejarán de verse en el inicio (podés volver a crear tu perfil profesional más adelante).',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Dar de baja',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                if (isSupabaseConfigured()) {
                  await deactivateProfessionalProfileInSupabase();
                }
              } catch (e) {
                toast.warning(
                  e instanceof Error ? e.message : 'No se pudo dar de baja en el servidor.',
                  'Servidor',
                  { durationMs: 5200 },
                );
                return;
              }

              try {
                await deleteWorkerProfile();
                setWorkerTrade('Profesional');
                // Apagar modo worker local (la fuente de verdad se refresca al volver a cargar perfil desde Supabase).
                if (user) {
                  replaceOrMergeUser({ ...(user as any), worker: undefined });
                }
                if (navigation.canGoBack()) navigation.goBack();
                else navigation.navigate('MyAccount');
              } finally {
                // no-op
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppKeyboardAvoidingView style={{ flex: 1 }} extraOffset={44}>
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
          El domicilio para el mapa y la búsqueda lo editás en Perfil → Modificar datos. Acá ajustás
          radio, oficios y descripción.
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
                value={t.yearsExperience == null ? '' : String(t.yearsExperience)}
                onChangeText={(raw) => {
                  const digits = normalizeDigitsOnly(raw).slice(0, 2);
                  if (!digits) {
                    updateTrade(idx, { yearsExperience: null });
                    return;
                  }
                  const n = Math.floor(Number(digits) || 0);
                  updateTrade(idx, { yearsExperience: n });
                }}
                keyboardType="number-pad"
                style={[
                  styles.yearsInput,
                  fieldErrors[`trade_${idx}_years`] ? styles.inputError : null,
                ]}
                placeholder="(vacío)"
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

            <Text style={styles.fieldLabel}>Fotos del oficio (hasta 5)</Text>
            <ImagePickerComponent
              mode="multi"
              label="Fotos del oficio (hasta 5)"
              hint="Usá cámara o galería. Recorte 1:1 automático antes de subir."
              value={
                t.proofImageUris?.length
                  ? t.proofImageUris
                  : t.proofImageUri
                    ? [t.proofImageUri]
                    : []
              }
              onChange={(next) => {
                const arr = Array.isArray(next) ? next : [String(next ?? '')];
                const cleaned = arr.map((u) => String(u ?? '').trim()).filter(Boolean).slice(0, 5);
                updateTrade(idx, {
                  proofImageUri: cleaned[0] ?? undefined,
                  proofImageUris: cleaned.length ? cleaned : undefined,
                });
              }}
              maxCount={5}
              squareCrop
              jpegQuality={0.9}
            />

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
            layoutYs.current.coverage = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Radio de cobertura</Text>
          <Text style={styles.fieldHint}>
            Alcance en km desde el domicilio de tu perfil (1–300). El domicilio lo cambiás en Modificar
            datos.
          </Text>
          {fieldErrors.location ? (
            <Text style={styles.inlineError}>{fieldErrors.location}</Text>
          ) : null}
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
      </AppKeyboardAvoidingView>
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
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  photoThumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoThumbImg: { width: '100%', height: '100%' },
  photoTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  photoHint: { marginTop: 2, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  photoStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  photoMiniWrap: { width: 68, height: 68 },
  photoMini: {
    width: 68,
    height: 68,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoMiniRemove: { position: 'absolute', top: -6, right: -6 },
  inputError: {
    borderColor: '#DC2626',
    borderWidth: 2,
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
