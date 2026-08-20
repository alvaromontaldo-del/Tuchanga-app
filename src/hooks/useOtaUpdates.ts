import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

/** En builds EAS (no Expo Go / no Metro), busca OTA al abrir y al volver al foreground. */
export function useOtaUpdates() {
  useEffect(() => {
    if (__DEV__) return;

    let reloading = false;

    async function applyOtaIfAvailable() {
      if (reloading) return;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        reloading = true;
        if (Platform.OS === 'ios') {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await Updates.reloadAsync();
      } catch {
        /* sin red o updates deshabilitados en este build */
      }
    }

    void applyOtaIfAvailable();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void applyOtaIfAvailable();
    });

    return () => sub.remove();
  }, []);
}
