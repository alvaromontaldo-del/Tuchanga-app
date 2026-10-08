import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { signupRoleRegisterTarget } from '../../navigation/signupRoleEntry';

const modal = readFileSync('src/components/legal/TermsAndConditionsModal.tsx', 'utf8');
const register = readFileSync('src/screens/auth/RegisterScreen.tsx', 'utf8');

function styleBlock(name: string): string {
  const marker = `${name}: {`;
  const from = modal.indexOf(marker);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = modal.indexOf('},', from);
  expect(to).toBeGreaterThan(from);
  return modal.slice(from, to);
}

describe('modal de términos en el registro (#101)', () => {
  it('la hoja tiene altura fija y el ScrollView ocupa el alto restante', () => {
    expect(modal).toContain('useWindowDimensions');
    expect(modal).toContain('windowHeight * 0.92');
    expect(modal).toContain('height: sheetHeight');
    expect(modal).not.toContain("maxHeight: '92%'");

    expect(styleBlock('sheet')).toContain('flex: 1');
    expect(styleBlock('body')).toContain('flex: 1');
    expect(styleBlock('body')).toContain('minHeight: 0');
    expect(styleBlock('header')).toContain('flexShrink: 0');
    expect(styleBlock('footer')).toContain('flexShrink: 0');

    const scroll = modal.slice(modal.indexOf('<ScrollView'), modal.indexOf('>', modal.indexOf('<ScrollView')));
    expect(scroll).toContain('style={styles.body}');
    expect(scroll).toContain('nestedScrollEnabled');
    expect(scroll).not.toContain('showsVerticalScrollIndicator={false}');
  });

  it('cliente, profesional y comercio usan el mismo modal', () => {
    for (const choice of ['client', 'professional', 'commerce'] as const) {
      expect(signupRoleRegisterTarget(choice).screen).toBe('Register');
    }
    expect(register.split('<TermsAndConditionsModal').length - 1).toBe(1);
    const usage = register.slice(register.indexOf('<TermsAndConditionsModal'));
    expect(usage).not.toContain('asCommerce');
    expect(usage).not.toContain('asProfessional');
    expect(usage).toContain('mode="read"');

    expect(modal).toContain('buildTermsDocument');
    expect(modal).toContain('>Acepto<');
    expect(modal).toContain('>Cerrar<');
    expect(modal).not.toContain('toLocaleDateString');
    expect(modal).not.toContain('asCommerce');
    expect(register).toContain('disabled={!termsAccepted}');
    expect(register).toContain('Leí y acepto los');
  });
});
