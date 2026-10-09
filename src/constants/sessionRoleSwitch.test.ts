import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  availableSessionRoles,
  nextSessionRoleOnSwitch,
  sessionRoleSwitchButtonCopy,
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

  it('los tres, con comercio primero', () => {
    expect(
      availableSessionRoles({ hasEnabledCommerce: true, isProfessional: true }),
    ).toEqual(['commerce', 'professional', 'client']);
  });
});

describe('un toque cambia entre particular y comercio', () => {
  const comercioYProfesional = availableSessionRoles({
    hasEnabledCommerce: true,
    isProfessional: true,
  });
  const comercioYCliente = availableSessionRoles({
    hasEnabledCommerce: true,
    isProfessional: false,
  });
  const soloProfesional = availableSessionRoles({
    hasEnabledCommerce: false,
    isProfessional: true,
  });
  const soloCliente = availableSessionRoles({
    hasEnabledCommerce: false,
    isProfessional: false,
  });

  it('comercio y profesional: profesional ↔ comercio, y el cliente también va a comercio', () => {
    expect(nextSessionRoleOnSwitch('commerce', comercioYProfesional)).toBe('professional');
    expect(nextSessionRoleOnSwitch('professional', comercioYProfesional)).toBe('commerce');
    expect(nextSessionRoleOnSwitch('client', comercioYProfesional)).toBe('commerce');
    expect(nextSessionRoleOnSwitch('professional', comercioYProfesional)).not.toBe('client');
  });

  it('comercio sin profesional: cliente ↔ comercio', () => {
    expect(nextSessionRoleOnSwitch('commerce', comercioYCliente)).toBe('client');
    expect(nextSessionRoleOnSwitch('client', comercioYCliente)).toBe('commerce');
    expect(nextSessionRoleOnSwitch('professional', comercioYCliente)).toBe('commerce');
  });

  it('cliente y profesional sin comercio no tienen botón', () => {
    expect(nextSessionRoleOnSwitch('professional', soloProfesional)).toBeNull();
    expect(nextSessionRoleOnSwitch('client', soloProfesional)).toBeNull();
    expect(nextSessionRoleOnSwitch(null, soloProfesional)).toBeNull();
  });

  it('solo cliente no cambia', () => {
    expect(nextSessionRoleOnSwitch('client', soloCliente)).toBeNull();
    expect(nextSessionRoleOnSwitch(null, soloCliente)).toBeNull();
  });

  it('con current null y comercio toma el primero del orden', () => {
    expect(nextSessionRoleOnSwitch(null, comercioYProfesional)).toBe('commerce');
    expect(nextSessionRoleOnSwitch(null, comercioYCliente)).toBe('commerce');
  });
});

describe('textos del botón', () => {
  it('nombra el destino en español', () => {
    expect(sessionRoleSwitchLabel('commerce')).toBe('Comercio');
    expect(sessionRoleSwitchLabel('professional')).toBe('Profesional');
    expect(sessionRoleSwitchLabel('client')).toBe('Cliente');
  });

  it('con comercio dice Comercio o Particular, y aclara profesional o cliente', () => {
    const tres = availableSessionRoles({ hasEnabledCommerce: true, isProfessional: true });
    expect(sessionRoleSwitchButtonCopy('commerce', tres)).toEqual({
      title: 'Cambiar a Comercio',
      subtitle: 'Pasar a Comercio',
    });
    expect(sessionRoleSwitchButtonCopy('professional', tres)).toEqual({
      title: 'Cambiar a Particular',
      subtitle: 'Pasar a Profesional',
    });
    expect(sessionRoleSwitchButtonCopy('client', tres)).toEqual({
      title: 'Cambiar a Particular',
      subtitle: 'Pasar a Cliente',
    });
  });

  it('sin comercio el texto de respaldo no se muestra: no hay destino', () => {
    const roles = availableSessionRoles({ hasEnabledCommerce: false, isProfessional: true });
    expect(nextSessionRoleOnSwitch('client', roles)).toBeNull();
    expect(nextSessionRoleOnSwitch('professional', roles)).toBeNull();
    expect(sessionRoleSwitchButtonCopy('client', roles).title).toBe('Cambiar de rol');
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
    expect(readFileSync('src/constants/defaultLoginRole.ts', 'utf8')).toContain(
      'if (input.isWorker) return \'professional\'',
    );
  });

  it('perfil y comercio muestran el botón solo cuando hay destino', () => {
    const account = readFileSync('src/screens/account/MyAccountScreen.tsx', 'utf8');
    const commerce = readFileSync('src/screens/store/CommerceAccountScreen.tsx', 'utf8');
    expect(account).toContain('{nextRole && switchCopy ? (');
    expect(commerce).toContain('{nextRole && switchCopy ? (');
    expect(account).toContain('hasEnabledCommerce: hasCommerceStore');
    expect(commerce).toContain('hasEnabledCommerce: hasCommerceStore');
  });
});
