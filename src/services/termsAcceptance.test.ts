import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPANY_LEGAL } from '../constants/companyLegal';
import { TERMS_UPDATED_LABEL, TERMS_VERSION } from '../constants/terms';
import { buildTermsDocument, renderTermsMarkdown } from '../constants/termsDocument';
import {
  dismissedKeyAfterAccept,
  isTermsBackendUnavailable,
  needsTermsAcceptance,
  termsPromptRequired,
  termsSessionKey,
} from './termsAcceptanceRules';

describe('datos de la empresa en un solo lugar', () => {
  it('el documento toma razón social, CUIT, domicilio, mail y jurisdicción de la constante', () => {
    const source = readFileSync('src/constants/companyLegal.ts', 'utf8');
    const object = source.slice(source.indexOf('export const COMPANY_LEGAL'));
    const outside = source.slice(0, source.indexOf('export const COMPANY_LEGAL'));
    expect(outside).not.toContain('COMPLETAR');
    expect(object.match(/COMPLETAR/g)).toHaveLength(5);
    expect(COMPANY_LEGAL).toEqual({
      razonSocial: 'COMPLETAR',
      cuit: 'COMPLETAR',
      domicilioLegal: 'COMPLETAR',
      emailContacto: 'COMPLETAR',
      jurisdiccion: 'COMPLETAR',
    });

    const documentSource = readFileSync('src/constants/termsDocument.ts', 'utf8');
    expect(documentSource).not.toContain('COMPLETAR');
    expect(documentSource).not.toContain('[RAZÓN SOCIAL]');
    expect(documentSource).toContain('COMPANY_LEGAL');

    const doc = buildTermsDocument();
    const plain = `${doc.intro}\n${doc.sections.map((section) => section.body).join('\n')}`;
    expect(plain).toContain(`operada por ${COMPANY_LEGAL.razonSocial}, CUIT ${COMPANY_LEGAL.cuit}`);
    expect(plain).toContain(COMPANY_LEGAL.domicilioLegal);
    expect(plain).toContain(COMPANY_LEGAL.emailContacto);
    expect(plain).toContain(COMPANY_LEGAL.jurisdiccion);
    expect(plain).not.toContain('[CUIT]');
    expect(plain).not.toContain('[JURISDICCIÓN]');
  });

  it('el markdown de revisión coincide con el texto del documento', () => {
    const markdown = readFileSync('docs/terminos-y-condiciones-2026-10-01.md', 'utf8');
    expect(markdown).toBe(renderTermsMarkdown());
    expect(markdown).toContain(TERMS_UPDATED_LABEL);
    expect(markdown).toContain(TERMS_VERSION);
  });
});

describe('aceptación de términos', () => {
  it('pide aceptación si no hay fila, no hay fecha o la versión es vieja', () => {
    expect(needsTermsAcceptance(null)).toBe(true);
    expect(needsTermsAcceptance({ accepted_at: null, terms_version: null })).toBe(true);
    expect(
      needsTermsAcceptance({ accepted_at: '2026-01-01T00:00:00Z', terms_version: '2026-01-01' }),
    ).toBe(true);
    expect(
      needsTermsAcceptance({
        accepted_at: '2026-10-01T12:00:00Z',
        terms_version: TERMS_VERSION,
      }),
    ).toBe(false);
  });

  it('trata como ausente la tabla o el RPC que todavía no están', () => {
    expect(
      isTermsBackendUnavailable({
        message: 'Could not find the function public.accept_terms(p_version) in the schema cache',
        code: 'PGRST202',
      }),
    ).toBe(true);
    expect(
      isTermsBackendUnavailable({
        message: "Could not find the table 'public.terms_acceptances' in the schema cache",
        code: 'PGRST205',
      }),
    ).toBe(true);
    expect(isTermsBackendUnavailable({ message: 'not_authenticated' })).toBe(false);
    expect(isTermsBackendUnavailable({ message: 'Failed to fetch' })).toBe(false);
  });
});

describe('el pedido de Acepto no entra en loop', () => {
  const key = termsSessionKey('user-1');

  it('cerrar el cartel en esta sesión no lo reabre aunque una lectura tarde siga vacía', () => {
    const open = {
      authed: true,
      sessionKey: key,
      dismissedKey: null as string | null,
      backendUnavailable: false,
      readFailed: false,
      row: null,
    };
    expect(termsPromptRequired(open)).toBe(true);

    const dismissed = dismissedKeyAfterAccept('saved', key, null);
    expect(
      termsPromptRequired({
        ...open,
        sessionKey: termsSessionKey('user-1'),
        dismissedKey: dismissed,
      }),
    ).toBe(false);
  });

  it('un fallo deja el cartel para reintentar y no lo cierra para volver a abrirlo', () => {
    const dismissed = dismissedKeyAfterAccept('failed', key, null);
    expect(dismissed).toBeNull();
    expect(
      termsPromptRequired({
        authed: true,
        sessionKey: key,
        dismissedKey: dismissed,
        backendUnavailable: false,
        readFailed: false,
        row: null,
      }),
    ).toBe(true);
  });

  it('si la base no tiene la tabla, no se muestra el cartel', () => {
    const dismissed = dismissedKeyAfterAccept('unavailable', key, null);
    expect(
      termsPromptRequired({
        authed: true,
        sessionKey: key,
        dismissedKey: dismissed,
        backendUnavailable: true,
        readFailed: false,
        row: null,
      }),
    ).toBe(false);
    expect(
      termsPromptRequired({
        authed: true,
        sessionKey: key,
        dismissedKey: null,
        backendUnavailable: false,
        readFailed: true,
        row: null,
      }),
    ).toBe(false);
  });

  it('cambiar de rol usa la misma clave y no rearma el pedido', () => {
    const dismissed = dismissedKeyAfterAccept('saved', key, null);
    expect(termsSessionKey('user-1')).toBe(key);
    expect(key).not.toContain('commerce');
    expect(key).not.toContain('professional');
    expect(
      termsPromptRequired({
        authed: true,
        sessionKey: key,
        dismissedKey: dismissed,
        backendUnavailable: false,
        readFailed: false,
        row: { accepted_at: '2026-10-01T12:00:00Z', terms_version: TERMS_VERSION },
      }),
    ).toBe(false);
  });

  it('sin sesión no pide Acepto, y otra versión sí', () => {
    expect(
      termsPromptRequired({
        authed: false,
        sessionKey: null,
        dismissedKey: null,
        backendUnavailable: false,
        readFailed: false,
        row: null,
      }),
    ).toBe(false);
    expect(
      termsPromptRequired({
        authed: true,
        sessionKey: termsSessionKey('user-1', TERMS_VERSION),
        dismissedKey: termsSessionKey('user-1', '2026-01-01'),
        backendUnavailable: false,
        readFailed: false,
        row: { accepted_at: '2026-01-01T12:00:00Z', terms_version: '2026-01-01' },
      }),
    ).toBe(true);
  });

  it('el cartel está en la raíz y el registro de los tres perfiles sigue en la misma pantalla', () => {
    const root = readFileSync('src/navigation/RootNavigator.tsx', 'utf8');
    const gate = readFileSync('src/components/legal/TermsAcceptanceGate.tsx', 'utf8');
    const register = readFileSync('src/screens/auth/RegisterScreen.tsx', 'utf8');
    expect(root).toContain('<TermsAcceptanceGate />');
    const client = root.slice(root.indexOf('function ClientRoot'), root.indexOf('function CommerceRoot'));
    const commerce = root.slice(root.indexOf('function CommerceRoot'), root.indexOf('export function RootNavigator'));
    expect(client).not.toContain('TermsAcceptanceGate');
    expect(commerce).not.toContain('TermsAcceptanceGate');
    expect(client).toContain('SessionRolePickerModal');
    expect(commerce).toContain('SessionRolePickerModal');
    expect(gate).not.toContain('sessionRole');
    expect(gate).not.toContain('chooseSessionRole');
    expect(gate).toContain('dismissedKey');
    expect(register).toContain('disabled={!termsAccepted}');
    expect(register).toContain("mode=\"read\"");
    expect(register).toContain('Crear cuenta de comercio');
    expect(register).toContain('Crear cuenta de profesional');
  });
});
