import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppTextInput } from '../common/AppTextInput';
import { colors, radii, spacing } from '../../constants/theme';
import { isSupabaseConfigured } from '../../config/supabase';
import { fetchMyMatricula, uploadMyMatricula } from '../../services/matriculaVerificadaSupabase';
import {
  MATRICULA_MAX_PHOTOS,
  matriculaDraftProblem,
  matriculaUploadErrorMessage,
  type MyMatricula,
} from '../../utils/matriculaVerificada';
import { ensureCameraPermission, ensureGalleryPermission } from '../../utils/mediaPermissions';
import { useAppToast } from '../toast/toast';
import { MatriculaVerificadaBadge } from './MatriculaVerificadaBadge';

type DraftPhoto = { id: string; uri: string };

function photoId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function MatriculaCard() {
  const toast = useAppToast();
  const [row, setRow] = useState<MyMatricula | null>(null);
  const [numero, setNumero] = useState('');
  const [entidad, setEntidad] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const hydrated = useRef(false);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    try {
      const next = await fetchMyMatricula();
      setRow(next);
      setUnavailable(false);
      if (!hydrated.current) {
        setNumero(next?.numero ?? '');
        setEntidad(next?.entidad ?? '');
        hydrated.current = true;
      }
    } catch (e) {
      const message = matriculaUploadErrorMessage(e);
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

  function addUris(uris: string[]) {
    const incoming = uris.map((uri) => uri.trim()).filter(Boolean);
    if (!incoming.length) return;
    setPhotos((prev) => {
      const room = MATRICULA_MAX_PHOTOS - prev.length;
      if (room <= 0) return prev;
      const next = incoming.slice(0, room).map((uri) => ({ id: photoId(), uri }));
      return [...prev, ...next];
    });
  }

  async function onCamera() {
    if (photos.length >= MATRICULA_MAX_PHOTOS) {
      toast.error('Podés cargar hasta 3 fotos.', 'Matrícula');
      return;
    }
    const ok = await ensureCameraPermission();
    if (!ok) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    addUris([result.assets[0].uri]);
  }

  async function onGallery() {
    const room = MATRICULA_MAX_PHOTOS - photos.length;
    if (room <= 0) {
      toast.error('Podés cargar hasta 3 fotos.', 'Matrícula');
      return;
    }
    const ok = await ensureGalleryPermission();
    if (!ok) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: room,
    });
    if (result.canceled || !result.assets?.length) return;
    addUris(result.assets.map((asset) => asset.uri));
  }

  async function send() {
    const problem = matriculaDraftProblem({
      numero,
      entidad,
      photos: photos.length,
    });
    if (problem) {
      toast.error(problem, 'Matrícula');
      return;
    }
    setBusy(true);
    try {
      const next = await uploadMyMatricula({
        numero,
        entidad,
        uris: photos.map((photo) => photo.uri),
      });
      setRow(next);
      setNumero(next.numero || numero.trim());
      setEntidad(next.entidad || entidad.trim());
      setPhotos([]);
      setUnavailable(false);
      hydrated.current = true;
      toast.success('Quedó en revisión. Te avisamos si hace falta corregir algo.', 'Matrícula');
    } catch (e) {
      toast.error(matriculaUploadErrorMessage(e), 'No se pudo cargar', { durationMs: 4600 });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit() {
    if (row?.status !== 'aprobada') {
      void send();
      return;
    }
    Alert.alert(
      'Volver a enviar la matrícula',
      'Si la cargás de nuevo, la insignia se oculta hasta que YaChanga la apruebe otra vez.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar', onPress: () => void send() },
      ],
    );
  }

  const rejected = row?.status === 'rechazada';
  const room = MATRICULA_MAX_PHOTOS - photos.length;

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Matrícula</Text>
      <View style={styles.card}>
        <View style={styles.rule} />
        <View style={styles.lead}>
          <View style={styles.seal}>
            <Ionicons name="ribbon-outline" size={20} color="#8C6A3D" />
          </View>
          <View style={styles.leadCopy}>
            <Text style={styles.kicker}>Opcional</Text>
            <Text style={styles.copy}>
              Cargá el número, la entidad que la emitió y hasta tres fotos. Cuando la aprobemos, tu
              perfil muestra la insignia Matrícula verificada.
            </Text>
          </View>
        </View>

        <Text style={styles.hint}>
          Las fotos se achican para ocupar poco lugar y que se sigan leyendo. Si volvés a enviar, se
          borran las anteriores.
        </Text>

        {loading ? (
          <ActivityIndicator color="#8C6A3D" style={styles.loader} />
        ) : unavailable ? (
          <Text style={styles.hint}>La carga de la matrícula todavía no está habilitada.</Text>
        ) : (
          <>
            {row?.status === 'aprobada' ? (
              <View style={styles.statusBlock}>
                <MatriculaVerificadaBadge />
                <Text style={styles.statusOk}>Ya está visible en tu perfil.</Text>
              </View>
            ) : row?.status === 'pendiente' ? (
              <View style={styles.pending}>
                <Ionicons name="time-outline" size={16} color="#8A5A2B" />
                <Text style={styles.pendingText}>En revisión</Text>
              </View>
            ) : rejected ? (
              <View style={styles.rejected}>
                <Text style={styles.rejectedTitle}>No se aprobó. Podés enviar otra.</Text>
                {row?.motivo ? <Text style={styles.rejectedBody}>{row.motivo}</Text> : null}
              </View>
            ) : null}

            {row && row.fotos > 0 ? (
              <Text style={styles.hint}>
                {row.fotos === 1 ? 'Hay 1 foto guardada.' : `Hay ${row.fotos} fotos guardadas.`} Si
                enviás de nuevo, se reemplazan.
              </Text>
            ) : null}

            <AppTextInput
              label="Número de matrícula"
              value={numero}
              onChangeText={setNumero}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
              placeholder="Ej.: 12345"
              placeholderTextColor={colors.textSecondary}
              containerStyle={styles.field}
            />
            <AppTextInput
              label="Entidad emisora"
              value={entidad}
              onChangeText={setEntidad}
              autoCorrect={false}
              maxLength={80}
              placeholder="Ej.: Gobierno de la Ciudad"
              placeholderTextColor={colors.textSecondary}
              containerStyle={styles.field}
            />

            <Text style={styles.photosLabel}>Fotos</Text>
            <View style={styles.photos}>
              {photos.map((photo) => (
                <View key={photo.id} style={styles.photo}>
                  <Image source={{ uri: photo.uri }} style={styles.photoImg} />
                  <Pressable
                    onPress={() => setPhotos((prev) => prev.filter((item) => item.id !== photo.id))}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Quitar foto"
                    style={styles.photoRemove}
                  >
                    <Ionicons name="close" size={14} color="#2C2416" />
                  </Pressable>
                </View>
              ))}
              {Array.from({ length: room }, (_, index) => (
                <View key={`empty-${index}`} style={styles.photoEmpty}>
                  <Ionicons name="image-outline" size={18} color="#C4B39A" />
                </View>
              ))}
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={() => void onCamera()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Sacar foto de la matrícula"
                style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
              >
                <Ionicons name="camera-outline" size={18} color="#2C2416" />
                <Text style={styles.secondaryText}>Cámara</Text>
              </Pressable>
              <Pressable
                onPress={() => void onGallery()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Elegir fotos de la galería"
                style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
              >
                <Ionicons name="images-outline" size={18} color="#2C2416" />
                <Text style={styles.secondaryText}>Galería</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={onSubmit}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Enviar matrícula a revisión"
              style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
            >
              <Text style={styles.primaryText}>{busy ? 'Subiendo…' : 'Enviar a revisión'}</Text>
            </Pressable>
          </>
        )}
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
    backgroundColor: '#FBF7F1',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: '#E7D9C6',
    padding: spacing.md,
    overflow: 'hidden',
  },
  rule: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#C4A574',
  },
  lead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 4 },
  seal: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E6D4',
    borderWidth: 1,
    borderColor: '#E4D3B8',
  },
  leadCopy: { flex: 1 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#8C6A3D',
    marginBottom: 4,
  },
  copy: { fontSize: 14, lineHeight: 20, color: '#2C2416' },
  hint: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    color: '#6F6256',
  },
  loader: { marginTop: spacing.md },
  statusBlock: { marginTop: spacing.md, alignItems: 'flex-start' },
  statusOk: { marginTop: 6, fontSize: 13, fontWeight: '700', color: '#6B4E2E' },
  pending: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#F8EFE3',
    borderWidth: 1,
    borderColor: '#E4D3B8',
  },
  pendingText: { color: '#8A5A2B', fontSize: 13, fontWeight: '800' },
  rejected: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.input,
    backgroundColor: '#F8F1F1',
    borderWidth: 1,
    borderColor: '#E7CFCF',
  },
  rejectedTitle: { color: '#7A3E3E', fontWeight: '800', fontSize: 14 },
  rejectedBody: { marginTop: 6, color: '#5C3A3A', fontSize: 14, lineHeight: 20 },
  field: { marginTop: spacing.md },
  photosLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 13,
    fontWeight: '700',
    color: '#6F6256',
  },
  photos: { flexDirection: 'row', gap: spacing.sm },
  photo: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F3E6D4',
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251, 247, 241, 0.92)',
  },
  photoEmpty: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D9C7AE',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(243, 230, 212, 0.35)',
  },
  actions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: '#E4D3B8',
    backgroundColor: '#FFFCF8',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryText: { color: '#2C2416', fontWeight: '800', fontSize: 14 },
  primary: {
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  pressed: { opacity: 0.88 },
});
