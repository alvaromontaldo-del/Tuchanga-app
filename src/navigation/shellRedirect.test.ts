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

describe('cambio de shell: sesión y rutas viejas', () => {
  it('al cerrar sesión desde Comercio vuelve a Main (no queda el spinner)', () => {
    expect(
      shellRedirectTarget({
        isAuthed: false,
        shellLoading: true,
        isCommerceShell: false,
        focusedRouteName: 'Commerce',
      }),
    ).toBe('Main');
  });

  it('un invitado en el modal de login no se mueve', () => {
    expect(
      shellRedirectTarget({
        isAuthed: false,
        shellLoading: false,
        isCommerceShell: false,
        focusedRouteName: 'AuthModal',
      }),
    ).toBeNull();
  });

  it('limpia el shell anterior si quedó debajo en la raíz', () => {
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: false,
        focusedRouteName: 'Main',
        rootRouteNames: ['Commerce', 'Main'],
      }),
    ).toBe('Main');
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: true,
        focusedRouteName: 'Commerce',
        rootRouteNames: ['Main', 'Commerce'],
      }),
    ).toBe('Commerce');
    expect(
      shellRedirectTarget({
        ...ready,
        isCommerceShell: false,
        focusedRouteName: 'Main',
        rootRouteNames: ['Main'],
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
