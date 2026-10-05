import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BIOMETRIC_AUTH_TYPE,
  biometricFailureMessage,
  biometricLoginButtonLabel,
  biometricLoginOffer,
  biometricPromptMessage,
  parseBiometricCredentials,
  serializeBiometricCredentials,
  shouldDropRememberedBiometricLogin,
} from './biometricLogin';

describe('rótulo de ingreso biométrico', () => {
  it('usa la huella digital cuando el aparato informa fingerprint', () => {
    expect(biometricLoginButtonLabel([BIOMETRIC_AUTH_TYPE.FINGERPRINT])).toBe(
      'Ingresar con huella digital',
    );
  });

  it('usa Face ID cuando solo hay reconocimiento facial', () => {
    expect(biometricLoginButtonLabel([BIOMETRIC_AUTH_TYPE.FACIAL_RECOGNITION])).toBe(
      'Ingresar con Face ID',
    );
  });

  it('nombra huella y Face ID si el aparato tiene las dos', () => {
    expect(
      biometricLoginButtonLabel([
        BIOMETRIC_AUTH_TYPE.FINGERPRINT,
        BIOMETRIC_AUTH_TYPE.FACIAL_RECOGNITION,
      ]),
    ).toBe('Ingresar con huella / Face ID');
  });

  it('si no hay tipo, conserva el texto histórico de huella', () => {
    expect(biometricLoginButtonLabel([])).toBe('Ingresar con huella digital');
    expect(biometricLoginButtonLabel([BIOMETRIC_AUTH_TYPE.IRIS])).toBe(
      'Ingresar con huella digital',
    );
  });
});

describe('cuándo mostrar el botón', () => {
  const ready = {
    hasHardware: true,
    isEnrolled: true,
    authenticationTypes: [BIOMETRIC_AUTH_TYPE.FINGERPRINT],
    hasRememberedSession: true,
  };

  it('aparece solo con hardware, biometría cargada y una sesión recordada', () => {
    expect(biometricLoginOffer(ready)).toBe('Ingresar con huella digital');
  });

  it('no aparece en un aparato sin sensor, sin datos cargados o sin sesión', () => {
    expect(biometricLoginOffer({ ...ready, hasHardware: false })).toBeNull();
    expect(biometricLoginOffer({ ...ready, isEnrolled: false })).toBeNull();
    expect(biometricLoginOffer({ ...ready, hasRememberedSession: false })).toBeNull();
  });

  it('arma el mensaje del prompt según el rótulo', () => {
    expect(biometricPromptMessage('Ingresar con huella digital')).toBe(
      'Confirmá tu identidad con tu huella',
    );
    expect(biometricPromptMessage('Ingresar con Face ID')).toBe(
      'Confirmá tu identidad con Face ID',
    );
    expect(biometricPromptMessage('Ingresar con huella / Face ID')).toBe(
      'Confirmá tu identidad con huella o Face ID',
    );
  });
});

describe('sesión recordada', () => {
  it('guarda y lee email y contraseña', () => {
    const raw = serializeBiometricCredentials({
      email: ' Ana@YaChanga.com ',
      password: 'secreta',
    });
    expect(parseBiometricCredentials(raw)).toEqual({
      email: 'ana@yachanga.com',
      password: 'secreta',
    });
  });

  it('descarta JSON vacío o roto', () => {
    expect(parseBiometricCredentials(null)).toBeNull();
    expect(parseBiometricCredentials('')).toBeNull();
    expect(parseBiometricCredentials('{')).toBeNull();
    expect(parseBiometricCredentials(JSON.stringify({ email: 'a@b.com' }))).toBeNull();
    expect(parseBiometricCredentials(JSON.stringify({ email: '', password: 'x' }))).toBeNull();
  });

  it('olvida la sesión si la contraseña ya no sirve o la cuenta está dada de baja', () => {
    expect(
      shouldDropRememberedBiometricLogin({ message: 'Email o contraseña incorrectos.' }),
    ).toBe(true);
    expect(
      shouldDropRememberedBiometricLogin({
        message: 'Cuenta dada de baja',
        reason: 'account_deactivated',
      }),
    ).toBe(true);
    expect(
      shouldDropRememberedBiometricLogin({
        message: 'La conexión tardó demasiado. Revisá tu red.',
      }),
    ).toBe(false);
  });
});

describe('errores del prompt', () => {
  it('cancelar o usar contraseña no muestra error', () => {
    expect(biometricFailureMessage('user_cancel')).toBeNull();
    expect(biometricFailureMessage('user_fallback')).toBeNull();
    expect(biometricFailureMessage('system_cancel')).toBeNull();
  });

  it('un bloqueo o un fallo avisan y dejan el formulario', () => {
    expect(biometricFailureMessage('lockout')).toMatch(/email y contraseña/i);
    expect(biometricFailureMessage('authentication_failed')).toMatch(/huella o Face ID/i);
  });
});

describe('el login no se rediseña', () => {
  const login = readFileSync('src/screens/auth/LoginScreen.tsx', 'utf8');

  it('el email y la contraseña siguen entrando por el mismo cierre de sesión y rol', () => {
    expect(login).toContain('async function enterAfterSignIn');
    expect(login).toContain('await enterAfterSignIn(result.user)');
    expect(login).toContain('defaultSessionRoleAfterLogin');
    expect(login).toContain('loginAuthDismiss');
    expect(login).toContain("dismiss === 'close'");
    expect(login).toContain('closeAuthModal()');
    expect(login).not.toContain('Soy comercio');
    expect(login).not.toContain('RoleChoiceList');
  });

  it('el botón biométrico es condicional y reutiliza ese mismo ingreso', () => {
    expect(login).toContain('loadBiometricLoginOffer');
    expect(login).toContain('rememberBiometricLogin');
    expect(login).toContain('unlockBiometricCredentials');
    expect(login).toContain('shouldDropRememberedBiometricLogin');
    expect(login).toContain('{biometricLabel ? (');
    expect(login).toContain('title={biometricLabel}');
    expect(login).toContain('await enterAfterSignIn(result.user)');
    const biometricBranch = login.slice(login.indexOf('async function handleBiometric'));
    expect(biometricBranch).toContain('enterAfterSignIn(result.user)');
  });
});
