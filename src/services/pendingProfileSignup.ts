import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured } from '../config/supabase';
import type { SignUpPayload } from './auth';
import { registerMyStore } from './storeRegistrationSupabase';
import { persistSignUpToSupabase } from './supabaseUser';

const KEY = '@tuchanga/pending_profile_signup_v1';

type StoredProfile = Omit<SignUpPayload, 'password' | 'email' | 'pendingCommerce'>;

type Stored = {
  userId: string;
  profile: StoredProfile;
  /** Alta de comercio cargada en el registro, si el email todavía no estaba confirmado. */
  store?: SignUpPayload['pendingCommerce'];
};

export async function savePendingProfileSignup(userId: string, payload: SignUpPayload): Promise<void> {
  const { password: _pw, email: _em, pendingCommerce, ...profile } = payload;
  const data: Stored = {
    userId,
    profile,
    ...(pendingCommerce ? { store: pendingCommerce } : {}),
  };
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
    if (pending.store) {
      try {
        await registerMyStore(pending.store);
      } catch (storeErr) {
        const storeMsg = storeErr instanceof Error ? storeErr.message : String(storeErr);
        // Ya existe: no hace falta reintentar ni pedir los datos de nuevo.
        if (!/ya ten[eé]s un comercio/i.test(storeMsg)) throw storeErr;
      }
    }
    await clearPendingProfileSignup();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Solo limpiar si el conflicto es de identidad de OTRO usuario; si falla red/Storage, reintentar luego.
    if (/no se pudo crear la cuenta|ya está registrado|correo o dni/i.test(msg)) {
      await clearPendingProfileSignup();
    }
  }
}
