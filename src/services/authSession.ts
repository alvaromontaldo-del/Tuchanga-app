import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { AuthUser } from './auth';

type StoredSession = {
  user: AuthUser;
  /** Dejar listo para cuando el backend devuelva token */
  token?: string;
};

const KEY = 'tu-changa:auth-session:v1';

let memorySession: StoredSession | null = null;

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function webGet(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

async function webSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // ignore
  }
}

async function webRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  if (Platform.OS === 'web') {
    const fromLocal = safeJsonParse<StoredSession>(await webGet(localStorage, KEY));
    if (fromLocal) return fromLocal;
    return safeJsonParse<StoredSession>(await webGet(sessionStorage, KEY));
  }

  const raw = await AsyncStorage.getItem(KEY);
  return safeJsonParse<StoredSession>(raw) ?? memorySession;
}

export async function persistSession(session: StoredSession, keepSignedIn: boolean) {
  const raw = JSON.stringify(session);

  if (Platform.OS === 'web') {
    if (keepSignedIn) {
      await webSet(localStorage, KEY, raw);
      await webRemove(sessionStorage, KEY);
    } else {
      await webSet(sessionStorage, KEY, raw);
      await webRemove(localStorage, KEY);
    }
    return;
  }

  if (keepSignedIn) {
    await AsyncStorage.setItem(KEY, raw);
    memorySession = null;
  } else {
    memorySession = session;
    await AsyncStorage.removeItem(KEY);
  }
}

export async function clearSession() {
  if (Platform.OS === 'web') {
    await webRemove(localStorage, KEY);
    await webRemove(sessionStorage, KEY);
    return;
  }

  memorySession = null;
  await AsyncStorage.removeItem(KEY);
}

