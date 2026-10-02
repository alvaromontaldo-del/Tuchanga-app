import { TERMS_VERSION } from '../constants/terms';

export type TermsAcceptanceRow = {
  terms_accepted_at?: string | null;
  terms_version?: string | null;
};

type BackendError = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

/**
 * La base todavía no tiene las columnas o el RPC (OTA anterior al SQL).
 * En ese caso la app no debe trabar el ingreso.
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
    blob.includes('terms_accepted_at') ||
    blob.includes('terms_version')
  );
}

function missingBackendObject(blob: string): boolean {
  if (!blob) return false;
  return (
    blob.includes('does not exist') ||
    blob.includes('could not find') ||
    blob.includes('schema cache') ||
    blob.includes('42703') ||
    blob.includes('pgrst202') ||
    blob.includes('pgrst204')
  );
}

/** true si hay perfil y falta la aceptación de la versión vigente. Sin fila, no bloquea. */
export function needsTermsAcceptance(
  row: TermsAcceptanceRow | null | undefined,
  currentVersion: string = TERMS_VERSION,
): boolean {
  if (!row) return false;
  const acceptedAt = row.terms_accepted_at;
  const version = (row.terms_version ?? '').trim();
  if (!acceptedAt) return true;
  return version !== currentVersion;
}
