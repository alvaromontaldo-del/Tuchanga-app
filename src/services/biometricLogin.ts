/**
 * Cuándo mostrar «Ingresar con huella / Face ID» y cómo leer la sesión recordada.
 * Sin módulos nativos: el login por email sigue aunque el dispositivo no tenga biometría.
 *
 * Los números coinciden con `AuthenticationType` de expo-local-authentication.
 */
export const BIOMETRIC_AUTH_TYPE = {
  FINGERPRINT: 1,
  FACIAL_RECOGNITION: 2,
  IRIS: 3,
} as const;

export type BiometricCredentials = {
  email: string;
  password: string;
};

const SILENT_BIOMETRIC_ERRORS = new Set([
  'user_cancel',
  'system_cancel',
  'app_cancel',
  'user_fallback',
]);

/**
 * Texto del botón. Si el dispositivo no informa el tipo, se usa la huella:
 * es el rótulo que ya tenía el login.
 */
export function biometricLoginButtonLabel(authenticationTypes: readonly number[]): string {
  const hasFace = authenticationTypes.includes(BIOMETRIC_AUTH_TYPE.FACIAL_RECOGNITION);
  const hasFinger =
    authenticationTypes.includes(BIOMETRIC_AUTH_TYPE.FINGERPRINT) ||
    authenticationTypes.includes(BIOMETRIC_AUTH_TYPE.IRIS);
  if (hasFace && hasFinger) return 'Ingresar con huella / Face ID';
  if (hasFace) return 'Ingresar con Face ID';
  return 'Ingresar con huella digital';
}

export function biometricPromptMessage(label: string): string {
  if (label.includes('Face ID') && label.includes('huella')) {
    return 'Confirmá tu identidad con huella o Face ID';
  }
  if (label.includes('Face ID')) return 'Confirmá tu identidad con Face ID';
  return 'Confirmá tu identidad con tu huella';
}

/**
 * El botón aparece solo si el aparato puede usar biometría y este dispositivo
 * ya guardó un ingreso válido (la sesión recordada).
 */
export function biometricLoginOffer(input: {
  hasHardware: boolean;
  isEnrolled: boolean;
  authenticationTypes: readonly number[];
  hasRememberedSession: boolean;
}): string | null {
  if (!input.hasHardware || !input.isEnrolled || !input.hasRememberedSession) return null;
  return biometricLoginButtonLabel(input.authenticationTypes);
}

export function parseBiometricCredentials(raw: string | null | undefined): BiometricCredentials | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { email?: unknown; password?: unknown };
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
}

export function serializeBiometricCredentials(creds: BiometricCredentials): string {
  return JSON.stringify({
    email: creds.email.trim().toLowerCase(),
    password: creds.password,
  });
}

/** Cancelar o elegir contraseña no es un error de login. */
export function isSilentBiometricError(error: string | undefined): boolean {
  return Boolean(error && SILENT_BIOMETRIC_ERRORS.has(error));
}

export function biometricFailureMessage(error: string | undefined): string | null {
  if (!error || isSilentBiometricError(error)) return null;
  if (error === 'lockout') {
    return 'Demasiados intentos. Ingresá con tu email y contraseña.';
  }
  return 'No se pudo verificar tu huella o Face ID. Ingresá con tu email y contraseña.';
}

/**
 * Si la contraseña guardada ya no sirve, hay que olvidarla para no reintentar
 * un ingreso que el servidor va a rechazar.
 */
export function shouldDropRememberedBiometricLogin(result: {
  reason?: string;
  message: string;
}): boolean {
  if (result.reason === 'account_deactivated') return true;
  const message = result.message.toLowerCase();
  return (
    message.includes('incorrect') ||
    message.includes('inválid') ||
    message.includes('invalid') ||
    message.includes('wrong password')
  );
}
