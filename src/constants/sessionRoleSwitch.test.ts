import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  availableSessionRoles,
  nextSessionRoleOnSwitch,
  sessionRoleSwitchLabel,
} from './sessionRoleSwitch';

describe('roles disponibles para cambiar', () => {
  it('cliente solo no tiene otro rol', () => {
    expect(
      availableSessionRoles({ hasEnabledCommerce: false, isProfessional: false }),
    ).toEqual(['client']);
  });

  it('profesional y cliente, sin comercio', () => {
    expect(
      availableSessionRoles({ hasEnabledCommerce: false, isProfessional: true }),
    ).toEqual(['professional', 'client']);
  });

  it('comercio habilitado y cliente, sin perfil profesional', () => {
    expect(
      availableSessionRoles({ hasEnabledCommerce: true, isProfessional: false }),
    ).toEqual(['commerce', 'client']);
  });

  it('los tres, en el orden del anillo', () => {
    expect(
      availableSessionRoles({ hasEnabledCommerce: true, isProfessional: true }),
    ).toEqual(['commerce', 'professional', 'client']);
  });
});

describe('un toque cambia de rol sin selector', () => {
  const three = availableSessionRoles({ hasEnabledCommerce: true, isProfessional: true });

  it('con tres roles cicla comercio → profesional → cliente → comercio', () => {
    expect(nextSessionRoleOnSwitch('commerce', three)).toBe('professional');
    expect(nextSessionRoleOnSwitch('professional', three)).toBe('client');
    expect(nextSessionRoleOnSwitch('client', three)).toBe('commerce');
  });

  it('con dos roles pasa al otro', () => {
    const commerceAndClient = availableSessionRoles({
      hasEnabledCommerce: true,
      isProfessional: false,
    });
    expect(nextSessionRoleOnSwitch('commerce', commerceAndClient)).toBe('client');
    expect(nextSessionRoleOnSwitch('client', commerceAndClient)).toBe('commerce');

    const professionalAndClient = availableSessionRoles({
      hasEnabledCommerce: false,
      isProfessional: true,
    });
    expect(nextSessionRoleOnSwitch('professional', professionalAndClient)).toBe('client');
    expect(nextSessionRoleOnSwitch('client', professionalAndClient)).toBe('professional');
  });

  it('con un solo rol no cambia', () => {
    const onlyClient = availableSessionRoles({
      hasEnabledCommerce: false,
      isProfessional: false,
    });
    expect(nextSessionRoleOnSwitch('client', onlyClient)).toBeNull();
    expect(nextSessionRoleOnSwitch(null, onlyClient)).toBeNull();
  });

  it('si el rol actual no está entre los disponibles, toma el primero del orden', () => {
    const commerceAndClient = availableSessionRoles({
      hasEnabledCommerce: true,
      isProfessional: false,
    });
    expect(nextSessionRoleOnSwitch('professional', commerceAndClient)).toBe('commerce');
    expect(nextSessionRoleOnSwitch(null, three)).toBe('commerce');
  });

  it('salta el rol que la cuenta no tiene', () => {
    const noProfessional = availableSessionRoles({
      hasEnabledCommerce: true,
      isProfessional: false,
    });
    expect(noProfessional).not.toContain('professional');
    expect(nextSessionRoleOnSwitch('commerce', noProfessional)).toBe('client');
  });
});

describe('textos del botón', () => {
  it('nombra el destino en español', () => {
    expect(sessionRoleSwitchLabel('commerce')).toBe('Comercio');
    expect(sessionRoleSwitchLabel('professional')).toBe('Profesional');
    expect(sessionRoleSwitchLabel('client')).toBe('Cliente');
  });
});

describe('el login no usa el ciclo del botón', () => {
  it('el default de ingreso sigue en defaultSessionRoleAfterLogin', () => {
    const login = readFileSync('src/screens/auth/LoginScreen.tsx', 'utf8');
    const cycle = readFileSync('src/constants/sessionRoleSwitch.ts', 'utf8');
    expect(login).toContain('defaultSessionRoleAfterLogin');
    expect(login).not.toContain('nextSessionRoleOnSwitch');
    expect(cycle).toContain('defaultSessionRoleAfterLogin');
    expect(readFileSync('src/constants/defaultLoginRole.ts', 'utf8')).toContain(
      'if (input.hasEnabledCommerce) return \'commerce\'',
    );
  });
});
