import Constants from 'expo-constants';
import { Platform, StatusBar } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

/**
 * Inset superior fiable en Android (status bar + notch/cutout).
 * En muchos dispositivos `useSafeAreaInsets().top` es 0 aunque haya barra de estado.
 */
export function resolveTopSafeInset(insets: Pick<EdgeInsets, 'top'>): number {
  const fromProvider = Math.round(insets.top);
  if (Platform.OS !== 'android') {
    return fromProvider;
  }

  const statusBar =
    StatusBar.currentHeight ??
    (typeof Constants.statusBarHeight === 'number' ? Constants.statusBarHeight : 0);

  return Math.max(fromProvider, Math.round(statusBar), 28);
}

export function resolveSafeAreaInsets(insets: EdgeInsets): EdgeInsets {
  const top = resolveTopSafeInset(insets);
  return { ...insets, top };
}
