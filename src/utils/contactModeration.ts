/**
 * Moderación anti-contacto relajada para el chat (card #67).
 *
 * La versión anterior (#85) bloqueaba palabras del oficio (cinta, cable, calor,
 * mail, whatsapp, calle, meta). Acá solo se rechazan teléfonos reales y emails.
 * Perfiles, publicaciones y pedidos de materiales siguen sin ese filtro.
 */

export const CONTACT_MODERATION_POLICY_MESSAGE =
  'Por políticas de seguridad, no está permitido compartir datos de contacto fuera de la plataforma.';

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

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}/;
const CURRENCY_RES = [
  /[$] *\d{1,3}(?:[. ]\d{3})+(?:[.,]\d{1,2})?/g,
  /[$] *\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?/g,
  /[$] *\d+(?:[.,]\d{1,2})?/g,
];
const CONSECUTIVE_PHONE_RE = /(^|[^0-9])([0-9]{8,15})([^0-9]|$)/;
const GROUPED_PHONE_RE =
  /((?:\+ *)?(?:\(\d{1,4}\) *|\d{1,4}[ -]+){1,6}\d{2,4})/g;
const DOTTED_PHONE_RE = /(^|[^0-9])(\d{1,4}(?:\.\d{2,4}){1,4})([^0-9]|$)/g;
const THOUSANDS_RE = /^\d{1,3}(?:\.\d{3})+$/;

function digitCount(value: string): number {
  return value.replace(/[^0-9]/g, '').length;
}

/**
 * `email` o `telefono_num` si el texto trae un mail o un teléfono real.
 * Importes, fechas, medidas y palabras del oficio devuelven null.
 */
export function contactBlockedReason(textRaw: string): string | null {
  let t = normalizeModerationText(textRaw ?? '');
  if (!t) return null;

  if (EMAIL_RE.test(t)) return 'email';

  for (const re of CURRENCY_RES) {
    t = t.replace(re, ' ');
  }

  if (CONSECUTIVE_PHONE_RE.test(t)) return 'telefono_num';

  for (const match of t.matchAll(GROUPED_PHONE_RE)) {
    const digits = digitCount(match[1] ?? '');
    if (digits >= 8 && digits <= 15) return 'telefono_num';
  }

  for (const match of t.matchAll(DOTTED_PHONE_RE)) {
    const token = match[2] ?? '';
    if (THOUSANDS_RE.test(token)) continue;
    const digits = digitCount(token);
    if (digits >= 8 && digits <= 15) return 'telefono_num';
  }

  return null;
}

export function validateContactInfo(textRaw: string): ContactModerationResult {
  const code = contactBlockedReason(textRaw);
  if (!code) return ALLOWED;
  return {
    blocked: true,
    match: { code },
    message: CONTACT_MODERATION_POLICY_MESSAGE,
  };
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
 * Misma regla para text, image (epígrafe), budget y quotation.
 * `system` no se filtra: lo escriben funciones del servidor (pago, PIN, reclamo).
 */
export function messageContactBlockedReason(
  type: string | null | undefined,
  body: string | null | undefined,
  metadata?: unknown,
): string | null {
  if ((type ?? 'text') === 'system') return null;
  for (const text of collectMessageFreeTexts(body, metadata)) {
    const reason = contactBlockedReason(text);
    if (reason) return reason;
  }
  return null;
}
