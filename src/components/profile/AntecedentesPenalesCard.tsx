import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import {
  fetchMyAntecedentesPenales,
  uploadMyAntecedentesPenales,
} from '../../services/antecedentesPenalesSupabase';
import {
  ANTECEDENTES_GOB_URL,
  antecedentesUploadErrorMessage,
  type MyAntecedentes,
} from '../../utils/antecedentesPenales';
import { ensureCameraPermission, ensureGalleryPermission } from '../../utils/mediaPermissions';
import { useAppToast } from '../toast/toast';
import { AntecedentesPenalesBadge } from './AntecedentesPenalesBadge';

async function pickPdf(): Promise<string | null> {
  const DocumentPicker = await import('expo-document-picker');
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const asset = result.assets[0];
  const mime = (asset.mimeType ?? '').toLowerCase();
  const name = (asset.name ?? '').toLowerCase();
  if (mime && mime !== 'application/pdf' && !name.endsWith('.pdf')) {
    throw new Error('Elegí un archivo PDF.');
  }
  return asset.uri;
}

export function AntecedentesPenalesCard() {
  const toast = useAppToast();
  const [row, setRow] = useState<MyAntecedentes | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    try {
      const next = await fetchMyAntecedentesPenales();
      setRow(next);
      setUnavailable(false);
    } catch (e) {
      const message = antecedentesUploadErrorMessage(e);
      if (/no está habilitada/i.test(message)) setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function send(kind: 'image' | 'pdf', uri: string) {
    setBusy(true);
    try {
      const next = await uploadMyAntecedentesPenales({ kind, uri });
      setRow(next);
      setUnavailable(false);
      toast.success('Quedó en revisión. Te avisamos cuando lo veamos.', 'Certificado');
    } catch (e) {
      toast.error(antecedentesUploadErrorMessage(e), 'No se pudo cargar', { durationMs: 4600 });
    } finally {
      setBusy(false);
    }
  }

  function confirmIfApproved(run: () => void) {
    if (row?.status !== 'aprobado') {
      run();
      return;
    }
    Alert.alert(
      'Volver a enviar el certificado',
      'Si cargás otro archivo, el tilde verde se oculta hasta que YaChanga lo apruebe de nuevo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cargar otro', onPress: run },
      ],
    );
  }

  async function onCamera() {
    confirmIfApproved(() => {
      void (async () => {
        const ok = await ensureCameraPermission();
        if (!ok) return;
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        await send('image', result.assets[0].uri);
      })();
    });
  }

  async function onGallery() {
    confirmIfApproved(() => {
      void (async () => {
        const ok = await ensureGalleryPermission();
        if (!ok) return;
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        await send('image', result.assets[0].uri);
      })();
    });
  }

  async function onPdf() {
    confirmIfApproved(() => {
      void (async () => {
        try {
          const uri = await pickPdf();
          if (!uri) return;
          await send('pdf', uri);
        } catch (e) {
          toast.error(antecedentesUploadErrorMessage(e), 'PDF', { durationMs: 4600 });
        }
      })();
    });
  }

  const rejected = row?.status === 'rechazado';

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Antecedentes penales</Text>
      <View style={styles.card}>
        <View style={styles.lead}>
          <View style={styles.seal}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
          </View>
          <Text style={styles.copy}>
            Cargá el certificado y, cuando lo aprobemos, tu perfil muestra un tilde verde. Así vas a
            obtener más trabajos.
          </Text>
        </View>

        <Pressable
          onPress={() => {
            void Linking.openURL(ANTECEDENTES_GOB_URL);
          }}
          accessibilityRole="link"
          accessibilityLabel="Abrir el sitio para pedir el certificado de antecedentes penales"
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={styles.linkLabel}>Pedilo en el sitio del Estado</Text>
          <Text style={styles.linkUrl}>{ANTECEDENTES_GOB_URL}</Text>
        </Pressable>

        <Text style={styles.hint}>
          Foto o PDF. La foto se comprime para ocupar poco lugar y que se siga leyendo. El PDF no
          puede pasar de 2 MB. Si lo volvés a enviar, se borra el archivo anterior.
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : unavailable ? (
          <Text style={styles.hint}>La carga del certificado todavía no está habilitada.</Text>
        ) : row?.status === 'aprobado' ? (
          <View style={styles.statusBlock}>
            <AntecedentesPenalesBadge />
            <Text style={styles.statusOk}>Ya está visible en tu perfil.</Text>
          </View>
        ) : row?.status === 'pendiente' ? (
          <View style={styles.pending}>
            <Ionicons name="time-outline" size={16} color="#9A3412" />
            <Text style={styles.pendingText}>En revisión</Text>
          </View>
        ) : rejected ? (
          <View style={styles.rejected}>
            <Text style={styles.rejectedTitle}>No se aprobó. Podés enviar otro archivo.</Text>
            {row?.asunto ? <Text style={styles.rejectedBody}>{row.asunto}</Text> : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={() => void onCamera()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Sacar foto del certificado"
            style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
          >
            <Ionicons name="camera-outline" size={18} color="#fff" />
            <Text style={styles.primaryText}>{rejected ? 'Sacar otra foto' : 'Sacar foto'}</Text>
          </Pressable>
          <Pressable
            onPress={() => void onGallery()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Elegir foto de la galería"
            style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
          >
            <Ionicons name="image-outline" size={18} color={colors.text} />
            <Text style={styles.secondaryText}>Galería</Text>
          </Pressable>
          <Pressable
            onPress={() => void onPdf()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Adjuntar PDF del certificado"
            style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
          >
            <Ionicons name="document-text-outline" size={18} color={colors.text} />
            <Text style={styles.secondaryText}>PDF</Text>
          </Pressable>
        </View>
        {busy ? <Text style={styles.hint}>Subiendo…</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  lead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  seal: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(198, 40, 40, 0.08)',
  },
  copy: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
  link: { marginTop: spacing.md },
  linkLabel: { fontSize: 14, fontWeight: '800', color: colors.primary },
  linkUrl: { marginTop: 2, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  hint: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  loader: { marginTop: spacing.md },
  statusBlock: { marginTop: spacing.md, alignItems: 'flex-start' },
  statusOk: { marginTop: 6, fontSize: 13, fontWeight: '700', color: '#166534' },
  pending: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  pendingText: { color: '#9A3412', fontSize: 13, fontWeight: '800' },
  rejected: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.input,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  rejectedTitle: { color: '#991B1B', fontWeight: '800', fontSize: 14 },
  rejectedBody: { marginTop: 6, color: '#7F1D1D', fontSize: 14, lineHeight: 20 },
  actions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  pressed: { opacity: 0.88 },
});
