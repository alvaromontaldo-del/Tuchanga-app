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

  it('el markdown de revisión tiene el mismo texto que el modal', () => {
    const modal = readFileSync('src/components/legal/TermsAndConditionsModal.tsx', 'utf8');
    const markdown = readFileSync('docs/terminos-y-condiciones-2026-10-01.md', 'utf8');
    const bodyStart = modal.indexOf('function TermsBody');
    const bodyEnd = modal.indexOf('export function TermsAndConditionsModal');
    const body = modal.slice(bodyStart, bodyEnd);
    const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();
    const intro = body.match(/<Text style=\{styles\.p\}>([\s\S]*?)<\/Text>/);
    if (!intro) throw new Error('falta el párrafo inicial del modal');
    const sections = [...body.matchAll(/<Section title="([^"]+)">([\s\S]*?)<\/Section>/g)].map(
      (match) => `${match[1]}\n\n${collapse(match[2] ?? '')}`,
    );
    const fromModal = [
      'Términos y Condiciones',
      `Última actualización: ${readFileSync('src/constants/terms.ts', 'utf8').match(/TERMS_UPDATED_LABEL = '([^']+)'/)?.[1]} · Versión ${TERMS_VERSION}`,
      collapse(intro[1] ?? ''),
      ...sections,
    ].join('\n\n');
    const fromMarkdown = collapse(markdown.replace(/^# /gm, '').replace(/^## /gm, ''));
    expect(collapse(fromModal)).toBe(fromMarkdown);
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
