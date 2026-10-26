import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddressDeliveryField, type DeliveryGeoPoint } from '../location/AddressDeliveryField';
import { useAppToast } from '../toast/toast';
import { colors, radii, shadows, spacing } from '../../constants/theme';
import { fetchMyProfileIdentity } from '../../services/profileIdentitySupabase';
import {
  confirmConversationJobAddress,
  fetchMyConversationJobAddress,
  setConversationJobAddress,
} from '../../services/jobAddressSupabase';
import { fetchMyProfilePrivate } from '../../services/supabaseUser';
import { normalizeDisplayAddress } from '../../utils/formatAddress';
import {
  isJobAddressPaid,
  jobAddressCardMode,
  visibleJobAddressLabel,
} from '../../utils/jobAddressCard';

type Props = {
  conversationId: string;
  estadoPago: string | null | undefined;
  role: 'cliente' | 'trabajador';
};

/**
 * Tarjeta del cliente: la dirección de este trabajo, no la del perfil.
 * El profesional no la monta. Antes del pago no recibe ni el texto ni el punto.
 */
export function JobAddressBanner({ conversationId, estadoPago, role }: Props) {
  const toast = useAppToast();
  const insets = useSafeAreaInsets();
  const paid = isJobAddressPaid(estadoPago);
  const [profileText, setProfileText] = useState('');
  const [profilePoint, setProfilePoint] = useState<{ lat: number; lng: number } | null>(null);
  const [jobText, setJobText] = useState<string | null>(null);
  const [jobPoint, setJobPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftGeo, setDraftGeo] = useState<DeliveryGeoPoint | null>(null);
  const [alsoProfile, setAlsoProfile] = useState(false);
  const [busy, setBusy] = useState(false);

  const mode = jobAddressCardMode({ role, paid, confirmed });

  useEffect(() => {
    if (role !== 'cliente' || paid) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    setConfirmed(false);
    setJobText(null);
    setJobPoint(null);
    void (async () => {
      try {
        const [job, profile, identity] = await Promise.all([
          fetchMyConversationJobAddress(conversationId),
          fetchMyProfilePrivate(),
          fetchMyProfileIdentity(),
        ]);
        if (cancelled) return;
        setJobText(job?.text ?? null);
        setJobPoint(job?.lat != null && job.lng != null ? { lat: job.lat, lng: job.lng } : null);
        setConfirmed(Boolean(job?.confirmedAt));
        setProfileText(normalizeDisplayAddress(profile?.direccion_texto ?? ''));
        setProfilePoint(
          identity?.lat != null && identity.lng != null && !(identity.lat === 0 && identity.lng === 0)
            ? { lat: identity.lat, lng: identity.lng }
            : null,
        );
      } catch {
        if (!cancelled) toast.warning('No se pudo leer la dirección de este trabajo.', 'Dirección');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, paid, role, toast]);

  const label = visibleJobAddressLabel(jobText, profileText);

  const openEditor = useCallback(() => {
    const text = label;
    const point = jobPoint ?? profilePoint;
    setDraftText(text);
    setDraftGeo(point && text ? { address: text, lat: point.lat, lng: point.lng } : null);
    setAlsoProfile(false);
    setEditorOpen(true);
  }, [jobPoint, label, profilePoint]);

  const accept = useCallback(() => {
    if (busy || !label) return;
    setBusy(true);
    void confirmConversationJobAddress(conversationId)
      .then(() => setConfirmed(true))
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'No se pudo confirmar la dirección.', 'Dirección');
      })
      .finally(() => setBusy(false));
  }, [busy, conversationId, label, toast]);

  const save = useCallback(() => {
    if (busy || !draftGeo) {
      toast.warning('Elegí una sugerencia del mapa para guardar la dirección.', 'Dirección');
      return;
    }
    setBusy(true);
    void setConversationJobAddress({
      conversationId,
      text: draftGeo.address,
      lat: draftGeo.lat,
      lng: draftGeo.lng,
      alsoProfile,
    })
      .then(() => {
        const saved = normalizeDisplayAddress(draftGeo.address);
        setJobText(saved);
        setJobPoint({ lat: draftGeo.lat, lng: draftGeo.lng });
        setConfirmed(false);
        if (alsoProfile) setProfileText(saved);
        setEditorOpen(false);
        toast.success('El profesional va a cotizar con esta distancia.', 'Dirección');
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'No se pudo guardar la dirección.', 'Dirección');
      })
      .finally(() => setBusy(false));
  }, [alsoProfile, busy, conversationId, draftGeo, toast]);

  if (!ready || mode === 'hidden') return null;

  return (
    <View style={styles.wrap}>
      {mode === 'change' ? (
        <Pressable
          onPress={openEditor}
          accessibilityRole="button"
          accessibilityLabel="Cambiar dirección"
          style={({ pressed }) => [styles.collapsed, pressed && styles.pressed]}
        >
          <Ionicons name="location-outline" size={16} color={colors.primary} />
          <Text style={styles.collapsedText}>Cambiar dirección</Text>
        </Pressable>
      ) : (
        <View style={styles.card}>
          <Text style={styles.kicker}>Este trabajo</Text>
          <Text style={styles.lead}>El profesional cotizará según la distancia a:</Text>
          <Text style={styles.address} numberOfLines={3}>
            {label || 'Todavía no hay una dirección para este trabajo.'}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={accept}
              disabled={busy || !label}
              accessibilityRole="button"
              accessibilityLabel="Aceptar"
              style={({ pressed }) => [
                styles.primary,
                (!label || busy) && styles.disabled,
                pressed && label && styles.pressed,
              ]}
            >
              <Text style={styles.primaryText}>Aceptar</Text>
            </Pressable>
            <Pressable
              onPress={openEditor}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Editar dirección"
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>Editar dirección</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Modal visible={editorOpen} animationType="slide" transparent onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setEditorOpen(false)} accessibilityLabel="Cerrar" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Dirección de este trabajo</Text>
            <Text style={styles.sheetHint}>
              Buscá la calle y elegí una sugerencia para ver el mapa. Si no queda exacto, mové el pin.
              Vale solo para este trabajo.
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
            >
              <AddressDeliveryField
                label="Dirección"
                showMap
                showUseCurrentLocation
                value={draftText}
                onChangeText={setDraftText}
                geo={draftGeo}
                onGeoChange={setDraftGeo}
                placeholder="Calle, altura, localidad"
              />
              <View style={styles.toggleRow}>
                <View style={styles.toggleText}>
                  <Text style={styles.toggleTitle}>Guardar también como mi dirección principal</Text>
                  <Text style={styles.toggleHint}>Tu perfil cambia solo si activás esto.</Text>
                </View>
                <Switch
                  value={alsoProfile}
                  onValueChange={setAlsoProfile}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.surface}
                  accessibilityLabel="Guardar también como mi dirección principal"
                />
              </View>
            </ScrollView>
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => setEditorOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancelar"
                style={({ pressed }) => [styles.ghost, styles.sheetBtn, pressed && styles.pressed]}
              >
                <Text style={styles.ghostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Guardar dirección"
                style={({ pressed }) => [
                  styles.primary,
                  styles.sheetBtn,
                  busy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryText}>{busy ? 'Guardando…' : 'Guardar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  kicker: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.primary,
    fontWeight: '700',
    marginBottom: 4,
  },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  address: {
    marginTop: 4,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primary: {
    flex: 1,
    minHeight: 42,
    borderRadius: radii.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  ghost: {
    flex: 1,
    minHeight: 42,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  ghostText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82 },
  collapsed: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  collapsedText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    height: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    paddingHorizontal: spacing.lg,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  sheetHint: {
    paddingHorizontal: spacing.lg,
    marginTop: 4,
    marginBottom: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  sheetScroll: { flex: 1 },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  toggleRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggleText: { flex: 1 },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  toggleHint: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetBtn: { flex: 1 },
});
