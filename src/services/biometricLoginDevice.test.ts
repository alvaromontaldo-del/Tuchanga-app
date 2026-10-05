import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' }));

const localAuth = vi.hoisted(() => ({
  hasHardwareAsync: vi.fn(),
  isEnrolledAsync: vi.fn(),
  supportedAuthenticationTypesAsync: vi.fn(),
  authenticateAsync: vi.fn(),
}));

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

vi.mock('react-native', () => ({
  Platform: platform,
}));

vi.mock('expo-local-authentication', () => localAuth);
vi.mock('expo-secure-store', () => secureStore);

import { BIOMETRIC_AUTH_TYPE, serializeBiometricCredentials } from './biometricLogin';
import {
  BIOMETRIC_LOGIN_STORAGE_KEY,
  forgetBiometricLogin,
  loadBiometricLoginOffer,
  rememberBiometricLogin,
  unlockBiometricCredentials,
} from './biometricLoginDevice';

const stored = serializeBiometricCredentials({
  email: 'ana@yachanga.com',
  password: 'secreta',
});

beforeEach(() => {
  platform.OS = 'ios';
  localAuth.hasHardwareAsync.mockReset();
  localAuth.isEnrolledAsync.mockReset();
  localAuth.supportedAuthenticationTypesAsync.mockReset();
  localAuth.authenticateAsync.mockReset();
  secureStore.getItemAsync.mockReset();
  secureStore.setItemAsync.mockReset();
  secureStore.deleteItemAsync.mockReset();

  localAuth.hasHardwareAsync.mockResolvedValue(true);
  localAuth.isEnrolledAsync.mockResolvedValue(true);
  localAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
    BIOMETRIC_AUTH_TYPE.FINGERPRINT,
  ]);
  secureStore.getItemAsync.mockResolvedValue(stored);
  secureStore.setItemAsync.mockResolvedValue(undefined);
  secureStore.deleteItemAsync.mockResolvedValue(undefined);
});

describe('oferta en el dispositivo', () => {
  it('muestra la huella si hay sensor, datos y sesión recordada', async () => {
    await expect(loadBiometricLoginOffer()).resolves.toBe('Ingresar con huella digital');
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(BIOMETRIC_LOGIN_STORAGE_KEY);
  });

  it('muestra Face ID si el aparato solo tiene rostro', async () => {
    localAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
      BIOMETRIC_AUTH_TYPE.FACIAL_RECOGNITION,
    ]);
    await expect(loadBiometricLoginOffer()).resolves.toBe('Ingresar con Face ID');
  });

  it('no muestra nada en web ni si falta la sesión', async () => {
    platform.OS = 'web';
    await expect(loadBiometricLoginOffer()).resolves.toBeNull();
    expect(secureStore.getItemAsync).not.toHaveBeenCalled();

    platform.OS = 'android';
    secureStore.getItemAsync.mockResolvedValue(null);
    await expect(loadBiometricLoginOffer()).resolves.toBeNull();
  });

  it('si el módulo nativo no está, el login no se rompe y el botón queda oculto', async () => {
    localAuth.hasHardwareAsync.mockRejectedValue(new Error('ExpoLocalAuthentication missing'));
    await expect(loadBiometricLoginOffer()).resolves.toBeNull();
  });
});

describe('recordar y desbloquear', () => {
  it('guarda la contraseña solo si el dispositivo puede usar biometría', async () => {
    await rememberBiometricLogin(' Ana@YaChanga.com ', 'secreta');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      BIOMETRIC_LOGIN_STORAGE_KEY,
      stored,
      { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );

    secureStore.setItemAsync.mockClear();
    localAuth.isEnrolledAsync.mockResolvedValue(false);
    await rememberBiometricLogin('ana@yachanga.com', 'secreta');
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('reintenta sin opciones de llavero si el primer guardado falla', async () => {
    secureStore.setItemAsync
      .mockRejectedValueOnce(new Error('keychain'))
      .mockResolvedValueOnce(undefined);
    await rememberBiometricLogin('ana@yachanga.com', 'secreta');
    expect(secureStore.setItemAsync).toHaveBeenLastCalledWith(BIOMETRIC_LOGIN_STORAGE_KEY, stored);
  });

  it('al cancelar no devuelve credenciales', async () => {
    localAuth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });
    await expect(unlockBiometricCredentials()).resolves.toEqual({
      ok: false,
      cancelled: true,
      message: '',
    });
  });

  it('si la biometría pasa, devuelve el email y la contraseña guardados', async () => {
    localAuth.authenticateAsync.mockResolvedValue({ success: true });
    await expect(unlockBiometricCredentials()).resolves.toEqual({
      ok: true,
      email: 'ana@yachanga.com',
      password: 'secreta',
    });
    expect(localAuth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: 'Confirmá tu identidad con tu huella',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: true,
      }),
    );
  });

  it('olvida la clave guardada', async () => {
    await forgetBiometricLogin();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(BIOMETRIC_LOGIN_STORAGE_KEY);
  });
});
