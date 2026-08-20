import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import type { SignUpPayload } from './auth';
import { persistSignUpToSupabase } from './supabaseUser';

const KEY = '@tuchanga/pending_profile_signup_v1';

type Stored = {
  userId: string;
  profile: Omit<SignUpPayload, 'password' | 'email'>;
};

export async function savePendingProfileSignup(userId: string, payload: SignUpPayload): Promise<void> {
  const { password: _pw, email: _em, ...profile } = payload;
  const data: Stored = { userId, profile };
  await AsyncStorage.setItem(KEY, JSON.stringify(data));
}

export async function clearPendingProfileSignup(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

async function loadPending(): Promise<Stored | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

let applyChain: Promise<void> = Promise.resolve();

/**
 * Si el registro quedó guardado (p. ej. confirmación por email sin sesión), crea/completa el perfil al tener sesión.
 */
export function tryApplyPendingProfileSignup(userId: string): Promise<void> {
  applyChain = applyChain.then(() => applyPendingInternal(userId)).catch(() => undefined);
  return applyChain;
}

async function applyPendingInternal(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const pending = await loadPending();
  if (!pending || pending.userId !== userId) return;

  try {
    // persistSignUpToSupabase ya maneja perfil existente (trigger / alta parcial)
    // y completa birth_date + avatar en vez de descartar el pending.
    await persistSignUpToSupabase(pending.profile, userId);
    await clearPendingProfileSignup();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Solo limpiar si el conflicto es de identidad de OTRO usuario; si falla red/Storage, reintentar luego.
    if (/no se pudo crear la cuenta|ya está registrado|correo o dni/i.test(msg)) {
      await clearPendingProfileSignup();
    }
  }
}
