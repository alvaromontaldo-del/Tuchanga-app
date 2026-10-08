import { TERMS_VERSION } from '../constants/terms';

export type TermsAcceptanceRow = {
  accepted_at?: string | null;
  terms_version?: string | null;
};

export type AcceptTermsResult = 'saved' | 'unavailable' | 'failed';

type BackendError = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

/**
 * La base todavía no tiene la tabla o el RPC (la app puede publicarse antes del SQL).
 * En ese caso no se pide «Acepto»: si no, el cartel volvería a abrirse en cada ingreso.
 */
export function isTermsBackendUnavailable(error: BackendError | null | undefined): boolean {
  if (!error) return false;
  const blob = [error.message, error.details, error.hint, error.code]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .toLowerCase();
  if (!missingBackendObject(blob)) return false;
  return (
    blob.includes('accept_terms') ||
    blob.includes('terms_acceptances') ||
    blob.includes('terms_version') ||
    blob.includes('accepted_at')
  );
}

function missingBackendObject(blob: string): boolean {
  if (!blob) return false;
  return (
    blob.includes('does not exist') ||
    blob.includes('could not find') ||
    blob.includes('schema cache') ||
    blob.includes('42703') ||
    blob.includes('42p01') ||
    blob.includes('pgrst202') ||
    blob.includes('pgrst204') ||
    blob.includes('pgrst205')
  );
}

/**
 * true si esta lectura dice que falta la versión vigente.
 * Sin fila (lectura correcta) falta la constancia. Un error de red no llega acá.
 */
export function needsTermsAcceptance(
  row: TermsAcceptanceRow | null | undefined,
  currentVersion: string = TERMS_VERSION,
): boolean {
  if (!row) return true;
  const acceptedAt = typeof row.accepted_at === 'string' ? row.accepted_at.trim() : '';
  const version = (row.terms_version ?? '').trim();
  if (!acceptedAt) return true;
  return version !== currentVersion;
}

/** La clave no incluye el rol: cambiar de cliente a profesional o comercio no rearma el pedido. */
export function termsSessionKey(userId: string, version: string = TERMS_VERSION): string {
  return `${userId}\n${version}`;
}

/**
 * Si ya se cerró el cartel en esta sesión (aceptó, o la base todavía no tiene la tabla),
 * una lectura vieja que sigue diciendo «falta» no lo vuelve a abrir.
 */
export function termsPromptRequired(input: {
  authed: boolean;
  sessionKey: string | null;
  dismissedKey: string | null;
  backendUnavailable: boolean;
  readFailed: boolean;
  row: TermsAcceptanceRow | null | undefined;
}): boolean {
  if (!input.authed || !input.sessionKey) return false;
  if (input.dismissedKey != null && input.dismissedKey === input.sessionKey) return false;
  if (input.backendUnavailable || input.readFailed) return false;
  return needsTermsAcceptance(input.row);
}

/** «saved» y «unavailable» cierran el cartel. «failed» lo deja para reintentar, sin cerrarlo y reabrirlo. */
export function dismissedKeyAfterAccept(
  result: AcceptTermsResult,
  sessionKey: string,
  current: string | null,
): string | null {
  if (result === 'saved' || result === 'unavailable') return sessionKey;
  return current;
}
