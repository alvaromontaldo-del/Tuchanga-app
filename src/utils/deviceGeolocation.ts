import { Platform } from 'react-native';
import * as Location from 'expo-location';

export type HighAccuracyPosition = {
  lat: number;
  lng: number;
};

export type GetPositionResult =
  | { ok: true; position: HighAccuracyPosition }
  | { ok: false; reason: 'denied' | 'timeout' | 'unavailable' | 'error' };

export async function getHighAccuracyPosition(): Promise<GetPositionResult> {
  if (Platform.OS === 'web') {
    const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geolocation) return { ok: false, reason: 'unavailable' };

    return await new Promise<GetPositionResult>((resolve) => {
      geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            ok: true,
            position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
        },
        (err) => {
          if (err.code === 1) return resolve({ ok: false, reason: 'denied' });
          if (err.code === 3) return resolve({ ok: false, reason: 'timeout' });
          return resolve({ ok: false, reason: 'error' });
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
      );
    });
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
    return { ok: true, position: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

