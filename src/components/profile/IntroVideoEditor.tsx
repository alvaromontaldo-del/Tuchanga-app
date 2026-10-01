import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import {
  deleteIntroVideo,
  fetchIntroVideoPath,
  playbackUrlForPath,
  saveIntroVideoFromUri,
} from '../../services/introVideoSupabase';
import {
  INTRO_VIDEO_MAX_SECONDS,
  introVideoMimeFromAsset,
  isIntroVideoTooLarge,
  isIntroVideoTooLong,
  isLocalVideoUri,
} from '../../utils/introVideo';
import { canPlayIntroVideo, canRecordIntroVideo } from '../../utils/introVideoNative';
import { ensureCameraPermission, openAppSettings } from '../../utils/mediaPermissions';
import { useAppToast } from '../toast/toast';
import { IntroVideoPlayer } from './IntroVideoPlayer';

type Props = {
  userId: string;
};

type Draft = {
  uri: string;
  mime: 'video/mp4' | 'video/quicktime';
  fileSize?: number | null;
};

/**
 * Grabación con el picker de cámara que ya está en el binario
 * (`launchCameraAsync` + tope 30 s + vista previa nativa en iOS).
 * Guardar sube el archivo; descartar no toca el perfil.
 */
export function IntroVideoEditor({ userId }: Props) {
  const toast = useAppToast();
  const recordingAvailable = canRecordIntroVideo();
  const playbackAvailable = canPlayIntroVideo();
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'upload' | 'delete' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchIntroVideoPath(userId)
      .then((path) => {
        if (cancelled) return;
        setSavedPath(path);
        setSavedUrl(playbackUrlForPath(path));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const record = useCallback(async () => {
    if (!recordingAvailable || busy) return;
    const cameraOk = await ensureCameraPermission();
    if (!cameraOk) return;
    try {
      const current = await Camera.getMicrophonePermissionsAsync();
      if (!current.granted) {
        const asked = await Camera.requestMicrophonePermissionsAsync();
        if (!asked.granted) {
          Alert.alert(
            'Permiso de micrófono',
            'Para grabar el video con audio necesitamos el micrófono. Si ya lo bloqueaste, abrí Ajustes.',
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Abrir Ajustes', onPress: () => void openAppSettings() },
            ],
          );
          return;
        }
      }
    } catch {
      toast.error(
        'Esta versión de la app no puede usar el micrófono para el video.',
        'Video',
        { durationMs: 4200 },
      );
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: INTRO_VIDEO_MAX_SECONDS,
        allowsEditing: Platform.OS === 'ios',
        quality: 0.6,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
        videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
        cameraType: ImagePicker.CameraType.front,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const uri = asset?.uri?.trim() ?? '';
      if (!asset || !uri) return;
      if (asset.type === 'image' || asset.type === 'livePhoto') {
        toast.error('Tiene que ser un video, no una foto.', 'Video', { durationMs: 4200 });
        return;
      }
      if (isIntroVideoTooLong(asset.duration)) {
        toast.error('El video puede durar hasta 30 segundos. Volvé a grabarlo.', 'Video', {
          durationMs: 4200,
        });
        return;
      }
      if (isIntroVideoTooLarge(asset.fileSize)) {
        toast.error('El video pesa más de 30 MB. Volvé a grabarlo, más corto.', 'Video', {
          durationMs: 4200,
        });
        return;
      }
      const mime = introVideoMimeFromAsset(asset);
      if (!mime) {
        toast.error('Solo se aceptan videos MP4 o MOV. Volvé a grabarlo.', 'Video', {
          durationMs: 4200,
        });
        return;
      }
      setDraft({ uri, mime, fileSize: asset.fileSize });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo abrir la cámara para grabar.',
        'Video',
        { durationMs: 4200 },
      );
    }
  }, [busy, recordingAvailable, toast]);

  const saveDraft = useCallback(async () => {
    if (!draft || busy) return;
    setBusy('upload');
    setProgress(0);
    try {
      const saved = await saveIntroVideoFromUri({
        userId,
        localUri: draft.uri,
        mime: draft.mime,
        fileSize: draft.fileSize,
        previousPath: savedPath,
        onProgress: setProgress,
      });
      setSavedPath(saved.path);
      setSavedUrl(saved.playbackUrl);
      setDraft(null);
      toast.success('Video de presentación guardado.', 'Perfil', { durationMs: 3200 });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo guardar el video.',
        'Video',
        { durationMs: 4800 },
      );
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [busy, draft, savedPath, toast, userId]);

  const discardDraft = useCallback(() => {
    if (busy) return;
    setDraft(null);
  }, [busy]);

  const removeSaved = useCallback(() => {
    if (busy || !savedPath) return;
    Alert.alert('Eliminar video', 'Se quita el video de tu perfil público. Podés grabar otro después.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          setBusy('delete');
          void deleteIntroVideo(savedPath)
            .then(() => {
              setSavedPath(null);
              setSavedUrl(null);
              setDraft(null);
              toast.success('Video eliminado.', 'Perfil', { durationMs: 2800 });
            })
            .catch((e) => {
              toast.error(
                e instanceof Error ? e.message : 'No se pudo eliminar el video.',
                'Video',
                { durationMs: 4200 },
              );
            })
            .finally(() => setBusy(null));
        },
      },
    ]);
  }, [busy, savedPath, toast]);

  if (!recordingAvailable && !savedUrl) {
    if (loading) return null;
    return null;
  }

  const previewUri = draft?.uri ?? savedUrl;
  const showPlayer = Boolean(previewUri && playbackAvailable && (draft ? isLocalVideoUri(draft.uri) : true));
  const percent =
    progress == null ? null : Math.max(0, Math.min(100, Math.round(progress * 100)));

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Video de presentación</Text>
      <Text style={styles.hint}>
        Opcional. Hasta {INTRO_VIDEO_MAX_SECONDS} segundos con la cámara del teléfono. El perfil
        funciona igual si no cargás uno.
      </Text>

      {loading ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}

      {showPlayer && previewUri ? <IntroVideoPlayer uri={previewUri} /> : null}
      {draft && !playbackAvailable ? (
        <Text style={styles.hint}>
          El video quedó grabado. En esta versión no hay vista previa dentro de la ficha; igual
          podés guardarlo o descartarlo.
        </Text>
      ) : null}

      {busy === 'upload' ? (
        <View style={styles.progressRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.progressText}>
            {percent == null ? 'Subiendo video…' : `Subiendo video… ${percent}%`}
          </Text>
        </View>
      ) : null}

      {draft ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void saveDraft()}
            disabled={busy != null}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, busy && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Guardar video de presentación"
          >
            <Text style={styles.primaryText}>Guardar video</Text>
          </Pressable>
          <Pressable
            onPress={() => void record()}
            disabled={busy != null}
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Volver a grabar"
          >
            <Ionicons name="refresh" size={16} color={colors.primary} />
            <Text style={styles.secondaryText}>Volver a grabar</Text>
          </Pressable>
          <Pressable
            onPress={discardDraft}
            disabled={busy != null}
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Descartar video"
          >
            <Text style={styles.secondaryText}>Descartar</Text>
          </Pressable>
        </View>
      ) : savedUrl ? (
        <View style={styles.actions}>
          {recordingAvailable ? (
            <Pressable
              onPress={() => void record()}
              disabled={busy != null}
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Reemplazar video de presentación"
            >
              <Ionicons name="refresh" size={16} color={colors.primary} />
              <Text style={styles.secondaryText}>Reemplazar</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={removeSaved}
            disabled={busy != null}
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Eliminar video de presentación"
          >
            <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.secondaryText}>
              {busy === 'delete' ? 'Eliminando…' : 'Eliminar'}
            </Text>
          </Pressable>
        </View>
      ) : recordingAvailable ? (
        <Pressable
          onPress={() => void record()}
          disabled={busy != null || loading}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Grabar video de presentación"
        >
          <Ionicons name="videocam" size={18} color="#fff" />
          <Text style={styles.primaryText}>Grabar video</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  hint: { marginTop: spacing.xs, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  spinner: { marginTop: spacing.md },
  progressRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressText: { color: colors.text, fontWeight: '700' },
  actions: { marginTop: spacing.md, gap: spacing.sm },
  primaryBtn: {
    minHeight: 44,
    borderRadius: radii.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    minHeight: 42,
    borderRadius: radii.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
});
