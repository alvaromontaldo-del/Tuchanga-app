import { Ionicons } from '@expo/vector-icons';
import { Camera, CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  measureLocalVideoFile,
  playbackUrlForPath,
  saveIntroVideoFromUri,
} from '../../services/introVideoSupabase';
import {
  INTRO_VIDEO_MAX_SECONDS,
  INTRO_VIDEO_RECORD_MAX_BYTES,
  INTRO_VIDEO_RECORD_QUALITY,
  INTRO_VIDEO_TARGET_VIDEO_BPS,
  formatIntroVideoSizeLabel,
  introVideoMimeFromAsset,
  introVideoRecordingOptions,
  introVideoTooLargeMessage,
  isIntroVideoTooLarge,
  isIntroVideoTooLong,
  isLocalVideoUri,
} from '../../utils/introVideo';
import { canPlayIntroVideo, canRecordIntroVideo, canUseIntroVideoCamera } from '../../utils/introVideoNative';
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
  source: 'camera' | 'picker';
};

function measuredFileSize(uri: string, fallback?: number | null): number | null {
  return measureLocalVideoFile(uri) ?? (fallback != null && Number.isFinite(fallback) && fallback > 0 ? fallback : null);
}

/**
 * Graba con la cámara que ya está en el binario (expo-camera 17) en Android y iOS:
 * 480p, 400 kbps y corte a los 7 MB (el bucket acepta 10).
 * iOS además pide codec H.264 en recordAsync; sin eso el bitrate no aplica.
 * Sin ExpoCamera, cae al picker: en iOS recomprime a 640×480; en Android el
 * sistema no comprime y, si el archivo se pasa, se avisa en español.
 * Guardar sube el archivo; descartar no toca el perfil.
 */
export function IntroVideoEditor({ userId }: Props) {
  const toast = useAppToast();
  const inAppCamera = canUseIntroVideoCamera();
  const recordingAvailable = canRecordIntroVideo();
  const playbackAvailable = canPlayIntroVideo();
  const cameraRef = useRef<CameraView | null>(null);
  const recordingRef = useRef(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'upload' | 'delete' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

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

  const acceptRecorded = useCallback(
    (uri: string, fileSize?: number | null, source: 'camera' | 'picker' = 'camera') => {
      const size = measuredFileSize(uri, fileSize);
      if (isIntroVideoTooLarge(size)) {
        toast.error(introVideoTooLargeMessage(size, source), 'Video', { durationMs: 5200 });
        return;
      }
      const mime = introVideoMimeFromAsset({ uri });
      if (!mime) {
        toast.error('Solo se aceptan videos MP4 o MOV. Volvé a grabarlo.', 'Video', {
          durationMs: 4200,
        });
        return;
      }
      setDraft({ uri, mime, fileSize: size, source });
      if (size != null && size >= INTRO_VIDEO_RECORD_MAX_BYTES - 256 * 1024) {
        toast.warning(
          `La grabación llegó al tamaño máximo y se cortó. ${formatIntroVideoSizeLabel(size)} Podés guardarla o volver a grabar.`,
          'Video',
          { durationMs: 5200 },
        );
      }
    },
    [toast],
  );

  const ensureMic = useCallback(async () => {
    try {
      const current = await Camera.getMicrophonePermissionsAsync();
      if (current.granted) return true;
      const asked = await Camera.requestMicrophonePermissionsAsync();
      if (asked.granted) return true;
      Alert.alert(
        'Permiso de micrófono',
        'Para grabar el video con audio necesitamos el micrófono. Si ya lo bloqueaste, abrí Ajustes.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir Ajustes', onPress: () => void openAppSettings() },
        ],
      );
      return false;
    } catch {
      toast.error(
        'Esta versión de la app no puede usar el micrófono para el video.',
        'Video',
        { durationMs: 4200 },
      );
      return false;
    }
  }, [toast]);

  const recordWithPicker = useCallback(async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: INTRO_VIDEO_MAX_SECONDS,
        cameraType: ImagePicker.CameraType.front,
        // iOS recomprime. En Android videoQuality / videoExportPreset no existen:
        // el archivo sale en la calidad del sistema y se rechaza si no entra.
        allowsEditing: Platform.OS === 'ios',
        ...(Platform.OS === 'ios'
          ? {
              videoQuality: ImagePicker.UIImagePickerControllerQualityType.Low,
              videoExportPreset: ImagePicker.VideoExportPreset.H264_640x480,
            }
          : { quality: 0 }),
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
      acceptRecorded(uri, asset.fileSize, 'picker');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo abrir la cámara para grabar.',
        'Video',
        { durationMs: 4200 },
      );
    }
  }, [acceptRecorded, toast]);

  const record = useCallback(async () => {
    if (!recordingAvailable || busy || cameraOpen) return;
    const cameraOk = await ensureCameraPermission();
    if (!cameraOk) return;
    const micOk = await ensureMic();
    if (!micOk) return;
    if (inAppCamera) {
      setCameraReady(false);
      setElapsedSec(0);
      setCameraOpen(true);
      return;
    }
    await recordWithPicker();
  }, [busy, cameraOpen, ensureMic, inAppCamera, recordWithPicker, recordingAvailable]);

  const closeCamera = useCallback(() => {
    if (recordingRef.current) {
      cameraRef.current?.stopRecording();
      return;
    }
    setCameraOpen(false);
  }, []);

  const startRecording = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || !cameraReady || recordingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    setElapsedSec(0);
    const started = Date.now();
    const tick = setInterval(() => {
      setElapsedSec(
        Math.min(INTRO_VIDEO_MAX_SECONDS, Math.floor((Date.now() - started) / 1000)),
      );
    }, 200);
    try {
      const recorded = await camera.recordAsync(introVideoRecordingOptions(Platform.OS));
      const uri = recorded?.uri?.trim() ?? '';
      if (!uri) {
        toast.error('No se pudo guardar la grabación. Volvé a intentar.', 'Video', {
          durationMs: 4200,
        });
        return;
      }
      acceptRecorded(uri);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo grabar el video.',
        'Video',
        { durationMs: 4200 },
      );
    } finally {
      clearInterval(tick);
      recordingRef.current = false;
      setRecording(false);
      setCameraOpen(false);
    }
  }, [acceptRecorded, cameraReady, toast]);

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
        source: draft.source,
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
        Opcional. Hasta {INTRO_VIDEO_MAX_SECONDS} segundos con la cámara del teléfono, comprimido
        para que entre en el perfil. El perfil funciona igual si no cargás uno.
      </Text>

      {loading ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}

      {showPlayer && previewUri ? <IntroVideoPlayer uri={previewUri} /> : null}
      {draft ? (
        <Text style={styles.sizeLabel}>{formatIntroVideoSizeLabel(draft.fileSize)}</Text>
      ) : null}
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
          style={({ pressed }) => [styles.primaryBtn, styles.recordBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Grabar video de presentación"
        >
          <Ionicons name="videocam" size={18} color="#fff" />
          <Text style={styles.primaryText}>Grabar video</Text>
        </Pressable>
      ) : null}

      <Modal visible={cameraOpen} animationType="slide" onRequestClose={closeCamera}>
        <View style={styles.cameraShell}>
          {cameraOpen ? (
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="front"
              mode="video"
              mute={false}
              videoQuality={INTRO_VIDEO_RECORD_QUALITY}
              videoBitrate={INTRO_VIDEO_TARGET_VIDEO_BPS}
              onCameraReady={() => setCameraReady(true)}
              onMountError={() => {
                setCameraOpen(false);
                toast.error('No se pudo abrir la cámara. Volvé a intentar.', 'Video', {
                  durationMs: 4200,
                });
              }}
            />
          ) : null}
          <View style={styles.cameraTopBar}>
            <Text style={styles.timer}>
              0:{String(elapsedSec).padStart(2, '0')} / 0:{String(INTRO_VIDEO_MAX_SECONDS).padStart(2, '0')}
            </Text>
            <Pressable
              onPress={closeCamera}
              hitSlop={12}
              style={({ pressed }) => [styles.cameraIconBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={recording ? 'Detener grabación' : 'Cerrar cámara'}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.cameraBottomBar}>
            <Text style={styles.cameraHint}>
              {Platform.OS === 'ios'
                ? 'Cámara frontal · 480p · H.264 · se corta a los 30 s'
                : 'Cámara frontal · 480p · se corta a los 30 s'}
            </Text>
            {recording ? (
              <Pressable
                onPress={() => cameraRef.current?.stopRecording()}
                style={({ pressed }) => [styles.shutter, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Detener grabación"
              >
                <View style={styles.stopInner} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void startRecording()}
                disabled={!cameraReady}
                style={({ pressed }) => [
                  styles.shutter,
                  pressed && styles.pressed,
                  !cameraReady && styles.disabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Empezar a grabar"
              >
                <View style={styles.recordInner} />
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  hint: { marginTop: spacing.xs, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  sizeLabel: {
    marginTop: spacing.sm,
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  spinner: { marginTop: spacing.md },
  progressRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressText: { color: colors.text, fontWeight: '700' },
  actions: { marginTop: spacing.md, gap: spacing.sm },
  recordBtn: { marginTop: spacing.lg },
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
  cameraShell: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraTopBar: {
    position: 'absolute',
    top: 48,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timer: { color: '#fff', fontWeight: '800', fontSize: 16 },
  cameraIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cameraBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: 'center',
    gap: spacing.sm,
  },
  cameraHint: { color: '#fff', fontSize: 13, fontWeight: '600' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
  },
  stopInner: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
});
