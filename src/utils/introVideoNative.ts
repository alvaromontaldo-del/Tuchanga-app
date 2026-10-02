import { requireOptionalNativeModule } from 'expo-modules-core';
import { NativeModules, Platform } from 'react-native';

/**
 * OTA no puede sumar módulos nativos. Si el binario no trae el picker o el WebView,
 * escondemos la función en lugar de importar `expo-video` / `expo-av` (no están en el build).
 */
/** La compresión (480p + bitrate) vive en ExpoCamera, que ya está en el binario. */
export function canUseIntroVideoCamera(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    return requireOptionalNativeModule('ExpoCamera') != null;
  } catch {
    return false;
  }
}

export function canRecordIntroVideo(): boolean {
  if (Platform.OS === 'web') return false;
  if (canUseIntroVideoCamera()) return true;
  try {
    const native = requireOptionalNativeModule('ExponentImagePicker');
    return native != null && typeof native.launchCameraAsync === 'function';
  } catch {
    return false;
  }
}

export function canPlayIntroVideo(): boolean {
  if (Platform.OS === 'web') return true;
  try {
    const names = Object.keys(NativeModules ?? {});
    if (names.length === 0) return true;
    return names.some((name) => name.toLowerCase().includes('webview'));
  } catch {
    return false;
  }
}
