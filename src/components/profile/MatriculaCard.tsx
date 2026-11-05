import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppTextInput } from '../common/AppTextInput';
import { colors, radii, spacing } from '../../constants/theme';
import {
  deleteMyMatriculaFoto,
  signedMatriculaUrl,
  uploadMyMatriculaOficio,
} from '../../services/matriculaVerificadaSupabase';
import {
  MATRICULA_DELETE_APPROVED_WARNING,
  MATRICULA_OFICIO_CATALOG,
  matriculaDraftProblem,
  matriculaRoom,
  problemaEnvioMatriculaOficio,
  matriculaUploadErrorMessage,
  type MatriculaOficioCodigo,
  type MyMatriculaFoto,
  type MyMatriculaOficio,
} from '../../utils/matriculaVerificada';
import { ensureCameraPermission, ensureGalleryPermission } from '../../utils/mediaPermissions';
import { useAppToast } from '../toast/toast';
import { MatriculaVerificadaBadge } from './MatriculaVerificadaBadge';
import { OficioMatriculaIcon } from './OficioMatriculaIcon';

type DraftPhoto = { id: string; uri: string };

function photoId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const FOTO_LABEL: Record<MyMatriculaFoto['status'], string> = {
  pendiente: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
};

function FotoEstado({ foto }: { foto: MyMatriculaFoto }) {
  return (
    <View
      style={[
        styles.fotoChip,
        foto.status === 'aprobada' && styles.fotoChipOk,
        foto.status === 'rechazada' && styles.fotoChipNo,
      ]}
    >
      <Text
        style={[
          styles.fotoChipText,
          foto.status === 'aprobada' && styles.fotoChipTextOk,
          foto.status === 'rechazada' && styles.fotoChipTextNo,
        ]}
        numberOfLines={1}
      >
        {FOTO_LABEL[foto.status]}
      </Text>
    </View>
  );
}

export function MatriculaPhotoTile({
  uri,
  label,
  status,
  busy,
  onRemove,
}: {
  uri: string | null;
  label: string;
  status?: MyMatriculaFoto['status'];
  busy?: boolean;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.photo}>
      {uri ? (
        <Image source={{ uri }} style={styles.photoImg} />
      ) : (
        <View style={styles.photoFallback}>
          <Ionicons name="image-outline" size={18} color="#C4B39A" />
        </View>
      )}
      {status ? (
        <View style={styles.fotoChipWrap}>
          <FotoEstado foto={{ id: 'x', status, motivo: null, storagePath: '', identidadVersion: null }} />
        </View>
      ) : null}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={styles.photoRemove}
        >
          <Ionicons name="close" size={14} color="#2C2416" />
        </Pressable>
      ) : null}
    </View>
  );
}

type Props = {
  oficio: MatriculaOficioCodigo;
  row: MyMatriculaOficio | null;
  puedeCargar: boolean;
  onReload: () => Promise<void>;
};

export function MatriculaCard({ oficio, row, puedeCargar, onReload }: Props) {
  const toast = useAppToast();
  const catalog = MATRICULA_OFICIO_CATALOG[oficio];
  const [numero, setNumero] = useState(row?.numero ?? '');
  const [entidad, setEntidad] = useState(row?.entidad ?? '');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNumero(row?.numero ?? '');
    setEntidad(row?.entidad ?? '');
  }, [row?.numero, row?.entidad, row?.status]);

  useEffect(() => {
    let cancelled = false;
    const fotos = row?.fotos ?? [];
    if (!fotos.length) {
      setUrls({});
      return;
    }
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        fotos.map(async (foto) => {
          const url = await signedMatriculaUrl(foto.storagePath);
          if (url) next[foto.id] = url;
        }),
      );
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [row?.fotos]);

  const saved = row?.fotos.length ?? 0;
  const room = matriculaRoom(saved, photos.length);
  const verificada = row?.verificada === true;

  function addUris(uris: string[]) {
    const incoming = uris.map((uri) => uri.trim()).filter(Boolean);
    if (!incoming.length) return;
    setPhotos((prev) => {
      const space = matriculaRoom(saved, prev.length);
      if (space <= 0) return prev;
      return [...prev, ...incoming.slice(0, space).map((uri) => ({ id: photoId(), uri }))];
    });
  }

  async function onCamera() {
    if (!puedeCargar) return;
    if (room <= 0) {
      toast.error('Podés cargar hasta 3 fotos.', catalog.titulo);
      return;
    }
    const ok = await ensureCameraPermission();
    if (!ok) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    addUris([result.assets[0].uri]);
  }

  async function onGallery() {
    if (!puedeCargar) return;
    if (room <= 0) {
      toast.error('Podés cargar hasta 3 fotos.', catalog.titulo);
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
    if (row) {
      const identidad = problemaEnvioMatriculaOficio({
        estado: row,
        numero,
        entidad,
        fotosNuevas: photos.length,
      });
      if (identidad) {
        toast.error(identidad, catalog.titulo);
        return;
      }
    }
    const total = saved + photos.length;
    const fieldProblem = matriculaDraftProblem({ numero, entidad, photos: Math.max(total, 0) });
    if (fieldProblem) {
      toast.error(fieldProblem, catalog.titulo);
      return;
    }
    if (row && photos.length === 0 && numero.trim() === row.numero && entidad.trim() === row.entidad) {
      toast.error('No hay fotos nuevas ni cambios para enviar.', catalog.titulo);
      return;
    }
    const identidadNueva = Boolean(
      row && (numero.trim() !== row.numero || entidad.trim() !== row.entidad),
    );
    const fotosNuevas = photos.length;
    setBusy(true);
    try {
      await uploadMyMatriculaOficio({
        oficio,
        numero,
        entidad,
        uris: photos.map((photo) => photo.uri),
      });
      setPhotos([]);
      await onReload();
      toast.success(
        identidadNueva
          ? 'El número o la entidad quedaron en revisión. Las fotos anteriores siguen guardadas.'
          : fotosNuevas > 0
            ? 'Las fotos nuevas quedaron en revisión. Las que ya estaban aprobadas siguen igual.'
            : 'Quedó en revisión. Te avisamos si hace falta corregir algo.',
        catalog.titulo,
      );
    } catch (e) {
      toast.error(matriculaUploadErrorMessage(e), 'No se pudo cargar', { durationMs: 4600 });
    } finally {
      setBusy(false);
    }
  }

  function removeSaved(foto: MyMatriculaFoto) {
    const run = () => {
      void (async () => {
        setBusy(true);
        try {
          await deleteMyMatriculaFoto(foto.id);
          await onReload();
        } catch (e) {
          toast.error(matriculaUploadErrorMessage(e), 'No se pudo borrar', { durationMs: 4600 });
        } finally {
          setBusy(false);
        }
      })();
    };
    if (foto.status !== 'aprobada') {
      run();
      return;
    }
    Alert.alert('Borrar foto aprobada', MATRICULA_DELETE_APPROVED_WARNING, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: run },
    ]);
  }

  return (
    <View style={styles.card}>
      <View style={styles.rule} />
      <View style={styles.lead}>
        <OficioMatriculaIcon code={oficio} size={36} />
        <View style={styles.leadCopy}>
          <Text style={styles.kicker}>Opcional</Text>
          <Text style={styles.title}>{catalog.titulo}</Text>
          <Text style={styles.copy}>{catalog.descripcion}</Text>
        </View>
      </View>

      {verificada ? (
        <View style={styles.statusBlock} accessibilityLabel="Matrícula verificada">
          <MatriculaVerificadaBadge />
        </View>
      ) : row?.status === 'pendiente' ? (
        <View style={styles.pending}>
          <Ionicons name="time-outline" size={16} color="#8A5A2B" />
          <Text style={styles.pendingText}>En revisión</Text>
        </View>
      ) : row?.status === 'rechazada' ? (
        <View style={styles.rejected}>
          <Text style={styles.rejectedTitle}>No se aprobó. Podés enviar otra.</Text>
          {row.motivo ? <Text style={styles.rejectedBody}>{row.motivo}</Text> : null}
        </View>
      ) : null}

      {row?.status === 'pendiente' && row.fotos.some((foto) => foto.status === 'aprobada') ? (
        <Text style={styles.hint}>
          El número o la entidad están en revisión. El sello no se muestra hasta que los veamos. Las
          fotos anteriores siguen guardadas.
        </Text>
      ) : null}

      {row?.fotos.some((foto) => foto.status === 'rechazada' && foto.motivo) ? (
        <Text style={styles.hint}>
          {row.fotos
            .filter((foto) => foto.status === 'rechazada' && foto.motivo)
            .map((foto) => foto.motivo)
            .join(' ')}
        </Text>
      ) : null}

      <AppTextInput
        label="Número de matrícula"
        value={numero}
        onChangeText={setNumero}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={40}
        editable={puedeCargar && !busy}
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
        editable={puedeCargar && !busy}
        placeholder="Ej.: Gobierno de la Ciudad"
        placeholderTextColor={colors.textSecondary}
        containerStyle={styles.field}
      />

      <Text style={styles.photosLabel}>Fotos</Text>
      <View style={styles.photos}>
        {(row?.fotos ?? []).map((foto) => (
          <MatriculaPhotoTile
            key={foto.id}
            uri={urls[foto.id] ?? null}
            status={foto.status}
            label={`Quitar foto ${FOTO_LABEL[foto.status].toLowerCase()}`}
            busy={busy}
            onRemove={() => removeSaved(foto)}
          />
        ))}
        {photos.map((photo) => (
          <MatriculaPhotoTile
            key={photo.id}
            uri={photo.uri}
            label="Quitar foto"
            busy={busy}
            onRemove={() => setPhotos((prev) => prev.filter((item) => item.id !== photo.id))}
          />
        ))}
        {Array.from({ length: room }, (_, index) => (
          <View key={`empty-${index}`} style={styles.photoEmpty}>
            <Ionicons name="image-outline" size={18} color="#C4B39A" />
          </View>
        ))}
      </View>

      {puedeCargar ? (
        <>
          <View style={styles.actions}>
            <Pressable
              onPress={() => void onCamera()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Sacar foto de la matrícula de ${catalog.titulo}`}
              style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
            >
              <Ionicons name="camera-outline" size={18} color="#2C2416" />
              <Text style={styles.secondaryText}>Cámara</Text>
            </Pressable>
            <Pressable
              onPress={() => void onGallery()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Elegir fotos de la matrícula de ${catalog.titulo}`}
              style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
            >
              <Ionicons name="images-outline" size={18} color="#2C2416" />
              <Text style={styles.secondaryText}>Galería</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => void send()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Enviar matrícula de ${catalog.titulo} a revisión`}
            style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
          >
            <Text style={styles.primaryText}>{busy ? 'Subiendo…' : 'Enviar a revisión'}</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.hint}>
          Este oficio ya no está guardado en tu perfil. Podés borrar las fotos; no se pueden sumar otras.
        </Text>
      )}
    </View>
  );
}

export function MatriculaCardsLoading() {
  return <ActivityIndicator color="#8C6A3D" style={styles.loader} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FBF7F1',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: '#E7D9C6',
    padding: spacing.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
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
  leadCopy: { flex: 1 },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#8C6A3D',
    marginBottom: 2,
  },
  title: { fontSize: 16, fontWeight: '800', color: '#2C2416' },
  copy: { marginTop: 2, fontSize: 14, lineHeight: 20, color: '#2C2416' },
  hint: { marginTop: spacing.sm, fontSize: 13, lineHeight: 18, color: '#6F6256' },
  loader: { marginVertical: spacing.md },
  statusBlock: { marginTop: spacing.md, alignItems: 'flex-start' },
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
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photo: {
    width: 96,
    height: 96,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F3E6D4',
  },
  photoImg: { width: '100%', height: '100%' },
  photoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  fotoChipWrap: { position: 'absolute', left: 6, bottom: 6, right: 28 },
  fotoChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(248, 239, 227, 0.94)',
  },
  fotoChipOk: { backgroundColor: 'rgba(232, 244, 236, 0.94)' },
  fotoChipNo: { backgroundColor: 'rgba(248, 241, 241, 0.94)' },
  fotoChipText: { fontSize: 10, fontWeight: '800', color: '#8A5A2B' },
  fotoChipTextOk: { color: '#1F6B45' },
  fotoChipTextNo: { color: '#7A3E3E' },
  photoEmpty: {
    width: 96,
    height: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D9C7AE',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(243, 230, 212, 0.35)',
  },
  actions: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
