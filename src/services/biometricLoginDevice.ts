import { Platform } from 'react-native';
import {
  biometricFailureMessage,
  biometricLoginButtonLabel,
  biometricLoginOffer,
  biometricPromptMessage,
  parseBiometricCredentials,
  serializeBiometricCredentials,
  type BiometricCredentials,
} from './biometricLogin';

/**
 * Clave de SecureStore: solo letras, números, `.`, `-` y `_`.
 * La contraseña no va a AsyncStorage.
 */
export const BIOMETRIC_LOGIN_STORAGE_KEY = 'yachanga.biometric-login.v1';

export type BiometricUnlockResult =
  | { ok: true; email: string; password: string }
  | { ok: false; cancelled: boolean; message: string };

function isNativeMobile(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Import dinámico: si el binario todavía no trae el módulo nativo, el login
 * por email sigue y el botón no se muestra.
 */
async function loadNativeModules(): Promise<{
  localAuth: typeof import('expo-local-authentication');
  secureStore: typeof import('expo-secure-store');
} | null> {
  try {
    const [localAuth, secureStore] = await Promise.all([
      import('expo-local-authentication'),
      import('expo-secure-store'),
    ]);
    return { localAuth, secureStore };
  } catch {
    return null;
  }
}

/** Rótulo del botón, o null si este dispositivo o la sesión no lo permiten. */
export async function loadBiometricLoginOffer(): Promise<string | null> {
  if (!isNativeMobile()) return null;
  try {
    const native = await loadNativeModules();
    if (!native) return null;
    const [hasHardware, isEnrolled, authenticationTypes, raw] = await Promise.all([
      native.localAuth.hasHardwareAsync(),
      native.localAuth.isEnrolledAsync(),
      native.localAuth.supportedAuthenticationTypesAsync(),
      native.secureStore.getItemAsync(BIOMETRIC_LOGIN_STORAGE_KEY),
    ]);
    return biometricLoginOffer({
      hasHardware,
      isEnrolled,
      authenticationTypes,
      hasRememberedSession: parseBiometricCredentials(raw) != null,
    });
  } catch {
    return null;
  }
}

/**
 * Después de un email y contraseña válidos, deja el ingreso listo para la
 * próxima vez. No hace nada si no hay biometría, y nunca tira el login.
 */
export async function rememberBiometricLogin(email: string, password: string): Promise<void> {
  if (!isNativeMobile()) return;
  const normalized = parseBiometricCredentials(
    serializeBiometricCredentials({ email, password }),
  );
  if (!normalized) return;
  try {
    const native = await loadNativeModules();
    if (!native) return;
    const [hasHardware, isEnrolled] = await Promise.all([
      native.localAuth.hasHardwareAsync(),
      native.localAuth.isEnrolledAsync(),
    ]);
    if (!hasHardware || !isEnrolled) return;
    const payload = serializeBiometricCredentials(normalized);
    const options = {
      keychainAccessible: native.secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };
    try {
      await native.secureStore.setItemAsync(BIOMETRIC_LOGIN_STORAGE_KEY, payload, options);
    } catch {
      await native.secureStore.setItemAsync(BIOMETRIC_LOGIN_STORAGE_KEY, payload);
    }
  } catch {
    /* un fallo al recordar no puede frenar el ingreso */
  }
}

export async function forgetBiometricLogin(): Promise<void> {
  if (!isNativeMobile()) return;
  try {
    const native = await loadNativeModules();
    if (!native) return;
    await native.secureStore.deleteItemAsync(BIOMETRIC_LOGIN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function unlockBiometricCredentials(): Promise<BiometricUnlockResult> {
  if (!isNativeMobile()) {
    return { ok: false, cancelled: true, message: '' };
  }
  try {
    const native = await loadNativeModules();
    if (!native) {
      return {
        ok: false,
        cancelled: false,
        message: 'No se pudo verificar tu huella o Face ID. Ingresá con tu email y contraseña.',
      };
    }
    const authenticationTypes = await native.localAuth.supportedAuthenticationTypesAsync();
    const label = biometricLoginButtonLabel(authenticationTypes);
    const result = await native.localAuth.authenticateAsync({
      promptMessage: biometricPromptMessage(label),
      cancelLabel: 'Cancelar',
      fallbackLabel: 'Usar contraseña',
      disableDeviceFallback: true,
    });
    if (!result.success) {
      const message = biometricFailureMessage(result.error);
      return { ok: false, cancelled: message == null, message: message ?? '' };
    }
    const creds: BiometricCredentials | null = parseBiometricCredentials(
      await native.secureStore.getItemAsync(BIOMETRIC_LOGIN_STORAGE_KEY),
    );
    if (!creds) {
      return {
        ok: false,
        cancelled: false,
        message: 'Volvé a ingresar con email y contraseña para usar la huella o Face ID.',
      };
    }
    return { ok: true, email: creds.email, password: creds.password };
  } catch {
    return {
      ok: false,
      cancelled: false,
      message: 'No se pudo verificar tu huella o Face ID. Ingresá con tu email y contraseña.',
    };
  }
}
