import { describe, expect, it } from 'vitest';
import { registerAuthTarget } from './registerEntry';

describe('Registrate → Comercio', () => {
  it('abre el alta completa y no la pantalla de ingreso', () => {
    const target = registerAuthTarget('commerce');
    expect(target).toEqual({
      screen: 'Register',
      params: { asCommerce: true },
    });
    expect(target.screen).not.toBe('RegisterCommerce');
    expect(target.screen).not.toBe('Login');
  });

  it('el particular sigue yendo al registro sin modo comercio', () => {
    expect(registerAuthTarget('particular')).toEqual({
      screen: 'Register',
      params: { asCommerce: false },
    });
  });
});
