import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultSessionRoleAfterLogin,
  isWorkerAuthUser,
  loginAuthDismiss,
} from './defaultLoginRole';

describe('rol por defecto al ingresar', () => {
  it('prioriza Comercio aunque también sea profesional y cliente', () => {
    expect(
      defaultSessionRoleAfterLogin({ hasEnabledCommerce: true, isWorker: true }),
    ).toBe('commerce');
    expect(
      defaultSessionRoleAfterLogin({ hasEnabledCommerce: true, isWorker: false }),
    ).toBe('commerce');
  });

  it('elige Profesional si es trabajador y no tiene comercio habilitado', () => {
    expect(
      defaultSessionRoleAfterLogin({ hasEnabledCommerce: false, isWorker: true }),
    ).toBe('professional');
  });

  it('elige Cliente si no es comercio ni trabajador', () => {
    expect(
      defaultSessionRoleAfterLogin({ hasEnabledCommerce: false, isWorker: false }),
    ).toBe('client');
  });

  it('un alta de comercio solo pendiente no gana sobre el perfil de trabajador', () => {
    expect(
      defaultSessionRoleAfterLogin({ hasEnabledCommerce: false, isWorker: true }),
    ).toBe('professional');
  });
});

describe('perfil de trabajador en el usuario del login', () => {
  it('pide oficios y un radio de cobertura mayor a cero', () => {
    expect(
      isWorkerAuthUser({
        worker: { trades: [{ id: '1' }], coverageKm: 10 },
      }),
    ).toBe(true);
    expect(isWorkerAuthUser({ worker: { trades: [], coverageKm: 10 } })).toBe(false);
    expect(
      isWorkerAuthUser({ worker: { trades: [{ id: '1' }], coverageKm: 0 } }),
    ).toBe(false);
    expect(isWorkerAuthUser({ worker: undefined })).toBe(false);
    expect(isWorkerAuthUser(null)).toBe(false);
  });
});

describe('cierre del modal según el rol', () => {
  it('Comercio solo cierra el modal, también si había un redirect', () => {
    expect(loginAuthDismiss({ role: 'commerce', redirectTo: 'worker:abc' })).toBe('close');
    expect(loginAuthDismiss({ role: 'commerce' })).toBe('close');
  });

  it('Cliente y Profesional siguen el redirect o vuelven al inicio', () => {
    expect(loginAuthDismiss({ role: 'professional', redirectTo: 'worker:abc' })).toBe(
      'redirect',
    );
    expect(loginAuthDismiss({ role: 'client', redirectTo: 'worker:abc' })).toBe('redirect');
    expect(loginAuthDismiss({ role: 'professional' })).toBe('inicio');
    expect(loginAuthDismiss({ role: 'client' })).toBe('inicio');
  });

  it('el login de Comercio llama a closeAuthModal y no manda a Inicio', () => {
    const login = readFileSync('src/screens/auth/LoginScreen.tsx', 'utf8');
    expect(login).toContain('loginAuthDismiss');
    expect(login).toContain("dismiss === 'close'");
    expect(login).toContain('closeAuthModal()');
    expect(login).not.toContain('Soy comercio');
    expect(login).not.toContain('RoleChoiceList');
  });
});
