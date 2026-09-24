import { Alert, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

type PermKind = 'gallery' | 'camera' | 'location';

const TITLES: Record<PermKind, string> = {
  gallery: 'Permiso de galería',
  camera: 'Permiso de cámara',
  location: 'Permiso de ubicación',
};

const MESSAGES: Record<PermKind, string> = {
  gallery:
    'Para elegir fotos necesitamos acceso a tu galería. Si ya lo bloqueaste, abrí Ajustes y habilitalo.',
  camera:
    'Para sacar fotos necesitamos acceso a la cámara. Si ya lo bloqueaste, abrí Ajustes y habilitalo.',
  location:
    'Para usar tu ubicación necesitamos el permiso correspondiente. Si ya lo bloqueaste, abrí Ajustes y habilitalo.',
};

export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    if (Platform.OS === 'ios') {
      await Linking.openURL('app-settings:');
    }
  }
}

function promptDenied(kind: PermKind): void {
  Alert.alert(TITLES[kind], MESSAGES[kind], [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Abrir Ajustes',
      onPress: () => {
        void openAppSettings();
      },
    },
  ]);
}

/**
 * Pide permiso de galería. Si está denegado, muestra alerta con link a Ajustes.
 * Devuelve true solo si quedó granted.
 */
export async function ensureGalleryPermission(): Promise<boolean> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return true;

  if (current.canAskAgain !== false) {
    const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (asked.granted) return true;
  }

  promptDenied('gallery');
  return false;
}

/** Pide permiso de cámara; si está denegado, ofrece Abrir Ajustes. */
export async function ensureCameraPermission(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;

  if (current.canAskAgain !== false) {
    const asked = await ImagePicker.requestCameraPermissionsAsync();
    if (asked.granted) return true;
  }

  promptDenied('camera');
  return false;
}

/** Pide permiso de ubicación foreground; si está denegado, ofrece Abrir Ajustes. */
export async function ensureLocationPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;

  if (current.canAskAgain !== false) {
    const asked = await Location.requestForegroundPermissionsAsync();
    if (asked.granted) return true;
  }

  promptDenied('location');
  return false;
}
