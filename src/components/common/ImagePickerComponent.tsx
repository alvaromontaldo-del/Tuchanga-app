import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { ensureGalleryPermission, ensureCameraPermission, openAppSettings } from '../../utils/mediaPermissions';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radii, spacing } from '../../constants/theme';
import { normalizeLocalImageUri } from '../../utils/normalizeLocalImage';
import { useAppToast } from '../toast/toast';

type PickerMode = 'single' | 'multi';

type Props = {
  mode: PickerMode;
  label: string;
  hint?: string;
  /** En modo multi, máximo de imágenes. */
  maxCount?: number;
  value?: string | string[];
  onChange?: (next: string | string[]) => void;
  /** Si true, recorta al centro con ratio 1:1. */
  squareCrop?: boolean;
  /** Calidad final del JPEG (0–1). */
  jpegQuality?: number;
  /** Si false, no muestra miniaturas (útil cuando ya hay preview externa). */
  showPreview?: boolean;
  /** Cámara por defecto al abrir (selfie = front). */
  defaultCameraFacing?: 'front' | 'back';
  /** Mostrar botón para cambiar cámara. */
  allowCameraFlip?: boolean;
};

export function ImagePickerComponent({
  mode,
  label,
  hint,
  maxCount = 5,
  value,
  onChange,
  squareCrop = true,
  jpegQuality = 0.9,
  showPreview = true,
  defaultCameraFacing = 'back',
  allowCameraFlip = true,
}: Props) {
  const toast = useAppToast();
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>(defaultCameraFacing);

  const controlled = value !== undefined && onChange !== undefined;
  const [internal, setInternal] = useState<string[]>([]);

  const uris = useMemo(() => {
    const raw = controlled ? value : internal;
    if (mode === 'single') {
      const u = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
      return u ? [u] : [];
    }
    return Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
  }, [controlled, internal, mode, value]);

  const setUris = useCallback(
    (next: string[]) => {
      const cleaned = next.filter(Boolean);
      if (mode === 'single') {
        const v = cleaned[0] ?? '';
        if (controlled) onChange?.(v);
        else setInternal(v ? [v] : []);
        return;
      }
      const sliced = cleaned.slice(0, Math.max(1, Math.min(20, maxCount)));
      if (controlled) onChange?.(sliced);
      else setInternal(sliced);
    },
    [controlled, maxCount, mode, onChange],
  );

  // En modo single, permitir reemplazar la foto aunque ya exista.
  const canAddMore = mode === 'single' ? true : uris.length < maxCount;

  const ensureGalleryPerm = useCallback(async () => {
    return ensureGalleryPermission();
  }, []);

  const openGallery = useCallback(async () => {
    if (!canAddMore || busy) return;
    const ok = await ensureGalleryPerm();
    if (!ok) return;

    setBusy(true);
    try {
      const selectionLimit =
        mode === 'multi' ? Math.max(1, Math.min(maxCount - uris.length, maxCount)) : 1;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: mode === 'multi',
        selectionLimit: mode === 'multi' ? selectionLimit : 1,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const assets = (result.assets ?? []).map((a) => a.uri).filter(Boolean);
      if (assets.length === 0) return;

      const processed: string[] = [];
      for (const uri of assets) {
        processed.push(await normalizeLocalImageUri(uri, { squareCrop }));
      }

      if (mode === 'single') setUris([processed[0] ?? ''].filter(Boolean));
      else setUris([...uris, ...processed].filter(Boolean).slice(0, maxCount));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo elegir la imagen',
        'Imágenes',
        { durationMs: 4200 },
      );
    } finally {
      setBusy(false);
    }
  }, [busy, canAddMore, ensureGalleryPerm, jpegQuality, maxCount, mode, setUris, squareCrop, toast, uris]);

  const openCamera = useCallback(async () => {
    if (!canAddMore || busy) return;
    // Abrimos el modal siempre; adentro mostramos UI de permisos y pedimos permiso ahí.
    // Esto evita que el prompt del sistema quede “detrás” en algunos Android.
    setFacing(defaultCameraFacing);
    setCameraOpen(true);
  }, [busy, canAddMore, defaultCameraFacing]);

  const takePhoto = useCallback(async () => {
    if (busy) return;
    if (!cameraRef.current) return;
    setBusy(true);
    try {
      const pic = await (cameraRef.current as any).takePictureAsync?.({
        quality: 0.95,
        skipProcessing: Platform.OS === 'android' ? true : false,
      });
      const uri = String(pic?.uri ?? '').trim();
      if (!uri) return;

      const processed = await normalizeLocalImageUri(uri, { squareCrop });

      if (mode === 'single') setUris([processed]);
      else setUris([...uris, processed].slice(0, maxCount));

      setCameraOpen(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudo sacar la foto',
        'Cámara',
        { durationMs: 4200 },
      );
    } finally {
      setBusy(false);
    }
  }, [busy, jpegQuality, maxCount, mode, setUris, squareCrop, toast, uris]);

  const removeAt = useCallback(
    (idx: number) => {
      setUris(uris.filter((_, i) => i !== idx));
    },
    [setUris, uris],
  );

  const clearAll = useCallback(() => setUris([]), [setUris]);

  return (
    <View>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{label}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
        {uris.length > 0 ? (
          <Pressable
            onPress={clearAll}
            hitSlop={10}
            style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Quitar imágenes"
          >
            <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {showPreview ? (
        <View style={styles.thumbRow}>
          {uris.map((uri, idx) => (
            <View key={`${uri}-${idx}`} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              <Pressable
                style={styles.removeBtn}
                onPress={() => removeAt(idx)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Quitar foto"
              >
                <Ionicons name="close-circle" size={26} color={colors.primary} />
              </Pressable>
            </View>
          ))}

          {canAddMore ? (
            <View style={styles.addCol}>
              <Pressable
                style={({ pressed }) => [
                  styles.addTile,
                  styles.addTilePrimary,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
                onPress={() => void openGallery()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Elegir desde galería"
              >
                <Ionicons name="images-outline" size={26} color={colors.primary} />
                <Text style={styles.addTileText}>Galería</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.addTile, pressed && styles.pressed, busy && styles.disabled]}
                onPress={() => void openCamera()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Sacar foto"
              >
                <Ionicons name="camera-outline" size={26} color={colors.text} />
                <Text style={styles.addTileText}>Cámara</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.compactRow}>
          <Pressable
            style={({ pressed }) => [
              styles.compactBtn,
              styles.compactBtnPrimary,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
            onPress={() => void openGallery()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Elegir desde galería"
          >
            <Ionicons name="images-outline" size={18} color="#fff" />
            <Text style={[styles.compactBtnText, styles.compactBtnTextOnPrimary]}>Galería</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.compactBtn, pressed && styles.pressed, busy && styles.disabled]}
            onPress={() => void openCamera()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Sacar foto"
          >
            <Ionicons name="camera-outline" size={18} color={colors.text} />
            <Text style={styles.compactBtnText}>Cámara</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={cameraOpen} animationType="slide" onRequestClose={() => setCameraOpen(false)}>
        <View style={styles.cameraShell}>
          {cameraPerm?.granted ? (
            <CameraView ref={cameraRef as any} style={styles.camera} facing={facing} />
          ) : (
            <View style={styles.permGate}>
              <Ionicons name="camera-outline" size={44} color="#fff" />
              <Text style={styles.permTitle}>Permiso de cámara</Text>
              <Text style={styles.permText}>
                Para sacar fotos, habilitá el acceso a la cámara.
              </Text>
              <Pressable
                onPress={() => void requestCameraPerm()}
                style={({ pressed }) => [styles.permBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Pedir permiso de cámara"
              >
                <Text style={styles.permBtnText}>Dar permiso</Text>
              </Pressable>
              <Pressable
                onPress={() => void openAppSettings()}
                style={({ pressed }) => [styles.permBtn, pressed && styles.pressed, { marginTop: 10, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#fff' }]}
                accessibilityRole="button"
                accessibilityLabel="Abrir ajustes del sistema"
              >
                <Text style={styles.permBtnText}>Abrir Ajustes</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.cameraTopBar}>
            {allowCameraFlip && cameraPerm?.granted ? (
              <Pressable
                onPress={() => setFacing((p) => (p === 'back' ? 'front' : 'back'))}
                hitSlop={12}
                style={({ pressed }) => [styles.cameraIconBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Cambiar cámara"
              >
                <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setCameraOpen(false)}
              hitSlop={12}
              style={({ pressed }) => [styles.cameraIconBtn, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.cameraBottomBar}>
            <Pressable
              onPress={() => void takePhoto()}
              style={({ pressed }) => [styles.shutter, pressed && styles.pressed, busy && styles.disabled]}
              disabled={busy || !cameraPerm?.granted}
              accessibilityRole="button"
              accessibilityLabel="Tomar foto"
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const TILE = 96;

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  hint: { marginTop: 4, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  clearBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  thumbWrap: {
    width: TILE,
    height: TILE,
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: { width: '100%', height: '100%', backgroundColor: '#2C2C2C' },
  removeBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
  },
  addCol: {
    width: TILE * 2 + spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  addTile: {
    flex: 1,
    height: TILE,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addTilePrimary: {
    borderColor: 'rgba(239, 68, 68, 0.65)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  addTileText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  addTileIcon: { color: colors.text },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.6 },
  compactRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  compactBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  compactBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  compactBtnText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  compactBtnTextOnPrimary: { color: '#fff' },
  cameraShell: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: '#000',
  },
  permTitle: { marginTop: spacing.md, color: '#fff', fontSize: 18, fontWeight: '900' },
  permText: {
    marginTop: spacing.sm,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  permBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.button,
  },
  permBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  cameraTopBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingTop: Platform.OS === 'ios' ? 54 : 18,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cameraIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
    paddingTop: 18,
    alignItems: 'center',
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
});

