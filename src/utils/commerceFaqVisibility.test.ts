import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('preguntas frecuentes fuera del comercio', () => {
  it('la cuenta de comercio no ofrece FAQ', () => {
    const commerce = read('src/screens/store/CommerceAccountScreen.tsx');
    expect(commerce).not.toContain('Preguntas frecuentes');
    expect(commerce).not.toContain("navigate('Faq')");
    expect(commerce).not.toContain('accessibilityLabel="Preguntas frecuentes"');
  });

  it('cliente y profesional siguen entrando a FAQ', () => {
    const account = read('src/screens/account/MyAccountScreen.tsx');
    expect(account).toContain('Preguntas frecuentes');
    expect(account).toContain("navigation.navigate('Faq')");
    expect(read('src/navigation/AccountStack.tsx')).toContain('name="Faq"');
    expect(read('src/navigation/CommerceStack.tsx')).toContain('name="Faq"');
  });
});

describe('cambiar de rol sin selector', () => {
  it('comercio cambia de rol con un toque y no borra la sesión para abrir el picker', () => {
    const commerce = read('src/screens/store/CommerceAccountScreen.tsx');
    const start = commerce.indexOf('const onSwitchRole');
    const end = commerce.indexOf('const onSignOut');
    const fn = commerce.slice(start, end);
    expect(fn).toContain('chooseSessionRole(nextRole)');
    expect(fn).not.toContain('clearSessionRole');
    expect(commerce).toContain('Cambiar de rol');
    expect(commerce).not.toContain('Elegir otro rol');
    expect(commerce).toContain('nextSessionRoleOnSwitch');
    expect(commerce).toContain('clearSessionRole');
  });

  it('perfil de cliente y profesional usa el mismo ciclo', () => {
    const account = read('src/screens/account/MyAccountScreen.tsx');
    expect(account).toContain('nextSessionRoleOnSwitch');
    expect(account).toContain('title="Cambiar de rol"');
    expect(account).toContain('chooseSessionRole(nextRole)');
    const logout = account.slice(account.indexOf("title=\"Cerrar sesión\""));
    expect(logout).toContain('clearSessionRole');
  });

  it('el selector sigue para el primer ingreso sin rol elegido', () => {
    const picker = read('src/components/auth/SessionRolePickerModal.tsx');
    expect(picker).toContain('needsRoleChoice');
    expect(picker).toContain('¿Cómo querés ingresar?');
    expect(read('src/context/CommerceShellContext.tsx')).toContain('sessionRole == null');
  });
});
