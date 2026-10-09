/**
 * El envío no se rechaza. El dato de contacto se reemplaza en
 * `offplatformContact` (cliente y SQL). Estas funciones quedan para no
 * revivir el bloqueo por palabra de #85 ni el rechazo `message_blocked_contact`.
 * Perfiles y publicaciones siguen sin ese filtro.
 */

export { OFFPLATFORM_NOTICE as CONTACT_MODERATION_POLICY_MESSAGE } from './offplatformContact';

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

const ACCENT_FROM = 'áàäâãåéèëêíìïîóòöôõúùüûñ';
const ACCENT_TO = 'aaaaaaeeeeiiiiooooouuuun';

/** Misma normalización que `normalize_message_body` en Postgres. */
export function normalizeModerationText(raw: string): string {
  let folded = '';
  for (const ch of raw) {
    const i = ACCENT_FROM.indexOf(ch);
    folded += i >= 0 ? ACCENT_TO[i] : ch;
  }
  return folded.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Ya no rechaza el texto. El reemplazo vive en `redactOffplatformContact`. */
export function contactBlockedReason(_textRaw: string): string | null {
  return null;
}

export function validateContactInfo(_textRaw: string): ContactModerationResult {
  return ALLOWED;
}

export function detectBlockedContact(textRaw: string): BlockedContactMatch | null {
  const { match, message } = validateContactInfo(textRaw);
  if (!match || !message) return null;
  return { keyword: match.code, reason: message };
}

export type WorkerProfileTextModeration = {
  professional: ContactModerationResult;
  tradeDescriptions: ContactModerationResult[];
  hasViolation: boolean;
};

/** Perfiles y oficios: sin filtro anti-contacto (#85). */
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

/** Campos de texto libre del mensaje. No incluye ids, importes ni image_url. */
export const MESSAGE_FREE_TEXT_KEYS = [
  'service_detail',
  'description',
  'caption',
  'notes',
  'note',
  'detail',
  'comment',
  'label',
  'title',
  'text',
  'message',
] as const;

function appendFreeText(out: string[], value: unknown, depth: number): void {
  if (depth > 4 || value == null) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendFreeText(out, item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    for (const key of MESSAGE_FREE_TEXT_KEYS) {
      if (key in rec) appendFreeText(out, rec[key], depth + 1);
    }
  }
}

export function collectMessageFreeTexts(
  body: string | null | undefined,
  metadata?: unknown,
): string[] {
  const out: string[] = [];
  if (typeof body === 'string') out.push(body);
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const rec = metadata as Record<string, unknown>;
    for (const key of MESSAGE_FREE_TEXT_KEYS) {
      if (key in rec) appendFreeText(out, rec[key], 0);
    }
  }
  return out;
}

/**
 * Ya no rechaza text, image, budget ni quotation.
 * `system` tampoco: lo escriben las funciones del servidor.
 */
export function messageContactBlockedReason(
  _type: string | null | undefined,
  _body: string | null | undefined,
  _metadata?: unknown,
): string | null {
  return null;
}
