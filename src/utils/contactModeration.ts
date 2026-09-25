/**
 * Moderación anti-contacto desactivada a propósito (2026-09-25).
 * El filtro de teléfonos, mails, direcciones y palabras “de contacto” generaba
 * falsos positivos en el oficio (cinta, cable, charla de trabajo). Se elimina
 * hasta rediseñar la mitigación. Estas funciones quedan como no-op para que
 * ningún llamado residual rechace texto libre.
 */

export type ContactModerationMatch = {
  code: string;
  detail?: string;
};

export type ContactModerationResult = {
  blocked: boolean;
  match: ContactModerationMatch | null;
  message: string | null;
};

export type BlockedContactMatch = {
  keyword: string;
  reason: string;
};

const ALLOWED: ContactModerationResult = {
  blocked: false,
  match: null,
  message: null,
};

export function validateContactInfo(_textRaw: string): ContactModerationResult {
  return ALLOWED;
}

export function detectBlockedContact(_textRaw: string): BlockedContactMatch | null {
  return null;
}

export type WorkerProfileTextModeration = {
  professional: ContactModerationResult;
  tradeDescriptions: ContactModerationResult[];
  hasViolation: boolean;
};

export function validateWorkerProfileTexts(
  _professionalDescription: string,
  tradeDescriptions: string[],
): WorkerProfileTextModeration {
  return {
    professional: ALLOWED,
    tradeDescriptions: tradeDescriptions.map(() => ALLOWED),
    hasViolation: false,
  };
}
