import { describe, expect, it } from 'vitest';
import { isCommerceShell, shouldDemotePendingCommerceRole } from './commerceShellState';

const authed = {
  isAuthed: true,
  roleHydrated: true,
  sessionRole: 'commerce' as const,
  commerceIntent: true,
  hasApprovedStore: false,
  hasPendingStore: false,
};

describe('isCommerceShell', () => {
  it('es false si solo hay comercios pendientes aunque el rol sea commerce', () => {
    expect(
      isCommerceShell({
        ...authed,
        hasPendingStore: true,
      }),
    ).toBe(false);
  });

  it('es true si hay un comercio aprobado y el rol es commerce', () => {
    expect(
      isCommerceShell({
        ...authed,
        hasApprovedStore: true,
      }),
    ).toBe(true);
  });

  it('sigue en el módulo si hay un comercio aprobado junto con otro pendiente', () => {
    expect(
      isCommerceShell({
        ...authed,
        hasApprovedStore: true,
        hasPendingStore: true,
      }),
    ).toBe(true);
  });

  it('permite el alta cuando el rol es commerce y todavía no hay comercios', () => {
    expect(isCommerceShell(authed)).toBe(true);
  });

  it('es false con rol cliente aunque el comercio esté aprobado', () => {
    expect(
      isCommerceShell({
        ...authed,
        sessionRole: 'client',
        hasApprovedStore: true,
      }),
    ).toBe(false);
  });

  it('no entra al módulo por intent si el único comercio está pendiente', () => {
    expect(
      isCommerceShell({
        ...authed,
        sessionRole: null,
        commerceIntent: true,
        hasPendingStore: true,
      }),
    ).toBe(false);
  });
});

describe('shouldDemotePendingCommerceRole', () => {
  it('pide pasar a cliente cuando el rol guardado es commerce y solo hay pendientes', () => {
    expect(
      shouldDemotePendingCommerceRole({
        sessionRole: 'commerce',
        hasApprovedStore: false,
        hasPendingStore: true,
      }),
    ).toBe(true);
  });

  it('no toca el rol si hay un comercio aprobado', () => {
    expect(
      shouldDemotePendingCommerceRole({
        sessionRole: 'commerce',
        hasApprovedStore: true,
        hasPendingStore: false,
      }),
    ).toBe(false);
  });
});
