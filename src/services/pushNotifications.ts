import Constants from 'expo-constants';

import * as Notifications from 'expo-notifications';

import { Platform } from 'react-native';

import { getSupabaseClient } from '../lib/supabase';



export type PushTokenResult =

  | { ok: true; token: string }

  | { ok: false; reason: string };



function resolveEasProjectId(): string {

  const fromExtra = (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)

    ?.extra?.eas?.projectId;

  const fromEas = (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  return (fromExtra ?? fromEas ?? '').trim();

}



async function ensureAndroidNotificationChannel(): Promise<void> {

  if (Platform.OS !== 'android') return;



  await Notifications.setNotificationChannelAsync('default', {

    name: 'YaChanga',

    importance: Notifications.AndroidImportance.MAX,

    vibrationPattern: [0, 200, 200, 200],

    lightColor: '#EF4444',

    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,

    sound: 'default',

    enableVibrate: true,

    showBadge: true,

  });

}



async function ensureNotificationPermission(): Promise<Notifications.PermissionStatus> {

  const existing = await Notifications.getPermissionsAsync();

  if (existing.status === 'granted') return existing.status;



  const requested = await Notifications.requestPermissionsAsync({

    ios: {

      allowAlert: true,

      allowBadge: true,

      allowSound: true,

    },

  });

  return requested.status;

}



export async function registerAndGetExpoPushToken(): Promise<PushTokenResult> {

  try {

    const projectId = resolveEasProjectId();

    if (!projectId) {

      return { ok: false, reason: 'missing_project_id' };

    }



    await ensureAndroidNotificationChannel();



    const status = await ensureNotificationPermission();

    if (status !== 'granted') {

      return { ok: false, reason: 'permissions_denied' };

    }



    const res = await Notifications.getExpoPushTokenAsync({ projectId });

    const token = res?.data?.trim() ?? '';

    if (!token) return { ok: false, reason: 'no_token' };

    return { ok: true, token };

  } catch (e) {

    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();

    if (msg.includes('firebase') || msg.includes('fcm') || msg.includes('google-services')) {

      return { ok: false, reason: 'fcm_not_configured' };

    }

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



export async function clearExpoPushTokenFromSupabase(): Promise<void> {

  const sb = getSupabaseClient();

  const {

    data: { user },

    error: ue,

  } = await sb.auth.getUser();

  if (ue || !user?.id) return;

  await sb.from('profiles').update({ expo_push_token: null }).eq('id', user.id);

}


