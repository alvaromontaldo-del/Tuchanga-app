import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getSupabaseClient } from '../lib/supabase';

export type PushTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export async function registerAndGetExpoPushToken(): Promise<PushTokenResult> {
  try {
    // En Expo Go / simulador, el token puede no estar disponible.
    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants.easConfig as any)?.projectId;

    const perms = await Notifications.getPermissionsAsync();
    let status = perms.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      return { ok: false, reason: 'permissions_denied' };
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Mensajes',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 200, 200, 200],
        lightColor: '#FF231F7C',
      });
    }

    const res = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = res?.data ?? '';
    if (!token) return { ok: false, reason: 'no_token' };
    return { ok: true, token };
  } catch {
    return { ok: false, reason: 'unexpected' };
  }
}

export async function persistExpoPushTokenToSupabase(token: string): Promise<void> {
  const sb = getSupabaseClient();
  const {
    data: { user },
    error: ue,
  } = await sb.auth.getUser();
  if (ue || !user?.id) return;
  const t = (token ?? '').trim();
  if (!t) return;
  await sb.from('profiles').update({ expo_push_token: t }).eq('id', user.id);
}

