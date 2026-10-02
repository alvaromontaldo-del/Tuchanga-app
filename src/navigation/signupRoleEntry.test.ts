import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SIGNUP_ROLE_SCREEN_OPTIONS,
  signupRoleRegisterTarget,
} from './signupRoleEntry';

describe('pantalla para elegir cómo registrarse', () => {
  it('muestra tres botones grandes con la descripción de cada perfil', () => {
    expect(SIGNUP_ROLE_SCREEN_OPTIONS.map((option) => option.title)).toEqual([
      'Cliente',
      'Profesional',
      'Comercio',
    ]);
    expect(SIGNUP_ROLE_SCREEN_OPTIONS.map((option) => option.description)).toEqual([
      'Buscá y contratá profesionales',
      'Ofrecé tus servicios',
      'Vendé materiales a profesionales',
    ]);
  });

  it('cada perfil abre el registro que ya existe, sin una pantalla nueva de backend', () => {
    expect(signupRoleRegisterTarget('client')).toEqual({
      screen: 'Register',
      params: { asCommerce: false },
    });
    expect(signupRoleRegisterTarget('professional')).toEqual({
      screen: 'Register',
      params: { asCommerce: false, asProfessional: true },
    });
    expect(signupRoleRegisterTarget('commerce')).toEqual({
      screen: 'Register',
      params: { asCommerce: true },
    });
    expect(signupRoleRegisterTarget('commerce').screen).not.toBe('RegisterCommerce');
    expect(signupRoleRegisterTarget('commerce').screen).not.toBe('Login');
  });

  it('conserva el redirect del deep link al pasar al registro', () => {
    expect(signupRoleRegisterTarget('client', 'worker:abc')).toEqual({
      screen: 'Register',
      params: { asCommerce: false, redirectTo: 'worker:abc' },
    });
    expect(signupRoleRegisterTarget('professional', 'worker:abc').params.redirectTo).toBe(
      'worker:abc',
    );
    expect(signupRoleRegisterTarget('commerce', 'worker:abc').params).toMatchObject({
      asCommerce: true,
      redirectTo: 'worker:abc',
    });
  });

  it('la pantalla usa esos textos y no vuelve a poner el check de comercio', () => {
    const screen = readFileSync('src/screens/auth/SignupRoleScreen.tsx', 'utf8');
    expect(screen).toContain('SIGNUP_ROLE_SCREEN_OPTIONS');
    expect(screen).toContain('signupRoleRegisterTarget');
    expect(screen).toContain('Elegí cómo registrarte');
    expect(screen).toContain('option.title');
    expect(screen).toContain('option.description');
    expect(screen).not.toContain('Soy comercio');
    expect(screen).not.toMatch(/supabase|fetch\(|rpc\(/i);

    const login = readFileSync('src/screens/auth/LoginScreen.tsx', 'utf8');
    expect(login).toContain('SignupRole');
    expect(login).toContain('registrarte');
    expect(login).not.toContain('RoleChoiceList');
  });
});
