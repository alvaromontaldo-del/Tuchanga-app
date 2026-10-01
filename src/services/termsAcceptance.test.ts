import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERMS_VERSION } from '../constants/terms';
import { isTermsBackendUnavailable, needsTermsAcceptance } from './termsAcceptanceRules';

describe('aceptación de términos', () => {
  it('pide aceptación si no hay fecha o la versión es vieja', () => {
    expect(needsTermsAcceptance(null)).toBe(false);
    expect(needsTermsAcceptance({ terms_accepted_at: null, terms_version: null })).toBe(true);
    expect(
      needsTermsAcceptance({ terms_accepted_at: '2026-01-01T00:00:00Z', terms_version: '2026-01-01' }),
    ).toBe(true);
    expect(
      needsTermsAcceptance({
        terms_accepted_at: '2026-10-01T12:00:00Z',
        terms_version: TERMS_VERSION,
      }),
    ).toBe(false);
  });

  it('trata como ausente el RPC o las columnas que todavía no están', () => {
    expect(
      isTermsBackendUnavailable({
        message: 'Could not find the function public.accept_terms(p_version) in the schema cache',
        code: 'PGRST202',
      }),
    ).toBe(true);
    expect(
      isTermsBackendUnavailable({
        message: 'column profiles.terms_accepted_at does not exist',
        code: '42703',
      }),
    ).toBe(true);
    expect(isTermsBackendUnavailable({ message: 'not_authenticated' })).toBe(false);
    expect(isTermsBackendUnavailable({ message: 'Failed to fetch' })).toBe(false);
  });

  it('la fecha de los términos es una constante, no el día de hoy', () => {
    const modal = readFileSync('src/components/legal/TermsAndConditionsModal.tsx', 'utf8');
    const register = readFileSync('src/screens/auth/RegisterScreen.tsx', 'utf8');
    const account = readFileSync('src/screens/account/MyAccountScreen.tsx', 'utf8');
    const commerce = readFileSync('src/screens/store/CommerceAccountScreen.tsx', 'utf8');
    expect(modal).not.toContain('toLocaleDateString');
    expect(modal).toContain('TERMS_UPDATED_LABEL');
    expect(modal).toContain('TERMS_VERSION');
    expect(register).toContain('TERMS_VERSION');
    expect(register).toContain('disabled={!termsAccepted}');
    expect(account).toContain('TERMS_VERSION');
    expect(commerce).toContain('TERMS_VERSION');
  });
});
