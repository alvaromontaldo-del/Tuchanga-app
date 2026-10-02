import { describe, expect, it } from 'vitest';
import { shellRedirectTarget, shellResetState } from './shellRedirect';

const ready = {
  isAuthed: true,
  shellLoading: false,
  isCommerceShell: false,
  focusedRouteName: 'Main' as string | undefined,
};

describe('cambio de shell', () => {
  it('abre Comercio al pasar de Cliente (o Profesional) sin reutilizar Main', () => {
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: true,
        focusedRouteName: 'Main',
      }),
    ).toBe('Commerce');
  });

  it('vuelve a Main al salir de Comercio hacia Cliente o Profesional', () => {
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: false,
        focusedRouteName: 'Commerce',
      }),
    ).toBe('Main');
  });

  it('Cliente y Profesional comparten Main y no se redirigen entre sí', () => {
    expect(shellRedirectTarget(ready)).toBeNull();
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: false,
        focusedRouteName: 'Main',
      }),
    ).toBeNull();
  });

  it('no redirige si ya está en el shell correcto', () => {
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: true,
        focusedRouteName: 'Commerce',
      }),
    ).toBeNull();
  });

  it('espera a que el rol y los comercios terminen de cargar', () => {
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: true,
        shellLoading: true,
        focusedRouteName: 'Main',
      }),
    ).toBeNull();
  });

  it('no interrumpe el login ni el checkout', () => {
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: true,
        focusedRouteName: 'AuthModal',
      }),
    ).toBeNull();
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: true,
        focusedRouteName: 'PagoCheckout',
      }),
    ).toBeNull();
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: false,
        focusedRouteName: 'PagoRetorno',
      }),
    ).toBeNull();
  });

  it('no mueve a un invitado', () => {
    expect(
      shellRedirectTarget({
        ...ready,
        isAuthed: false,
        isCommerceShell: true,
        focusedRouteName: 'Main',
      }),
    ).toBeNull();
  });
});

describe('shellResetState', () => {
  it('no arrastra el state anidado del shell anterior', () => {
    expect(shellResetState('Commerce')).toEqual({
      index: 0,
      routes: [{ name: 'Commerce' }],
    });
    expect(shellResetState('Main').routes[0]).not.toHaveProperty('state');
  });
});
