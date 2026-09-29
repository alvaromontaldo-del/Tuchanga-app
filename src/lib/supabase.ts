import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from '../config/supabase';
import { payloadIndicatesUserBanned } from '../services/accountDeactivation';

/**
 * fetch() sin tope puede quedar colgado minutos si el firewall no corta bien el TCP.
 * Abortamos y fallamos en un tiempo acotado (mejor UX y coincide con timeouts de auth).
 */
const SUPABASE_FETCH_TIMEOUT_MS = 32_000;

type AuthBannedListener = () => void;
let authBannedListener: AuthBannedListener | null = null;

/**
 * AuthProvider la usa para, a mitad de sesión, volver a consultar la baja
 * si GoTrue responde `user_banned`.
 */
export function setAuthBannedListener(listener: AuthBannedListener | null) {
  authBannedListener = listener;
}

function notifyIfBannedResponse(status: number, body: string) {
  if (status !== 400 && status !== 401 && status !== 403) return;
  if (!payloadIndicatesUserBanned(body)) return;
  try {
    authBannedListener?.();
  } catch {
    /* ignore */
  }
}

export async function supabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  const upstream = init?.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      try {
        const text = await response.clone().text();
        notifyIfBannedResponse(response.status, text);
      } catch {
        /* no bloquear la respuesta original */
      }
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

const webStorage = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve(null);
    try {
      return Promise.resolve(window.localStorage.getItem(key));
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return Promise.resolve();
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return Promise.resolve();
  },
};

let client: SupabaseClient | null = null;

/**
 * Cliente Supabase singleton (auth persistente). Solo invocar si `isSupabaseConfigured()`.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase no está configurado (EXPO_PUBLIC_SUPABASE_URL / ANON_KEY).');
  }
  if (!client) {
    client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: {
        fetch: supabaseFetch,
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
      auth: {
        storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        /** Web (Expo): sin lock explícito evita cuelgues con GoTrue + listeners (Strict Mode / modal login). */
        ...(Platform.OS === 'web'
          ? {
              lock: async <R,>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) =>
                fn(),
            }
          : {}),
      },
    });
  }
  return client;
}
