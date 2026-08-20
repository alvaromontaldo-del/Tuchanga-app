/**
 * Moderación anti-contacto (chat, publicaciones, descripciones).
 * Mantener reglas alineadas con `contact_info_blocked_reason` en Supabase.
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

export const CONTACT_MODERATION_POLICY_MESSAGE =
  'Por políticas de seguridad, no está permitido compartir datos de contacto fuera de la plataforma.';

/** Mensaje en formularios de perfil / registro profesional. */
export const CONTACT_MODERATION_PROFILE_FIELD_MESSAGE =
  'Por motivos de seguridad, no está permitido incluir datos de contacto externos.';

export type BlockedContactMatch = {
  keyword: string;
  reason: string;
};

type Rule = { code: string; re: RegExp };

const RULES: Rule[] = [
  { code: 'whatsapp', re: /\b(whatsapp|whats\s*app|wsp|wp|wap|wa)\b/i },
  { code: 'facebook', re: /\b(facebook|face\s*book|fb|meta)\b/i },
  { code: 'instagram', re: /\b(instagram|insta|ig)\b/i },
  { code: 'email', re: /\b(correo|correos|email|e-?mail|mail)\b/i },
  { code: 'telefono', re: /\b(cel(ular|u)?|tel|telefono|telefonos|phone|contacto|llamar|llamame)\b/i },
  { code: 'direccion', re: /\b(direccion|address|calle|avenida|av\.?|numero|nro|n°)\b/i },
  { code: 'url', re: /\b(url|link|enlace|http|https|www)\b/i },
  { code: 'dominio', re: /\bpunto\s*(com|net|org|ar)\b/i },
  { code: 'tld', re: /\.(com|net|org|ar|io|me|app)\b/i },
  { code: 'arroba', re: /@/ },
];

/** Palabras-número en español (sin "uno/una/un" para evitar falsos positivos). */
const SPANISH_NUMBER_WORD =
  /\b(cero|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil)\b/gi;

/** Orden: más largas primero para no partir "diecisiete" en "diez" + "siete". */
const SPANISH_NUMBER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bdiecisiete\b/g, '17'],
  [/\bdieciseis\b/g, '16'],
  [/\bdieciocho\b/g, '18'],
  [/\bdiecinueve\b/g, '19'],
  [/\bnoventa\b/g, '90'],
  [/\bochenta\b/g, '80'],
  [/\bsetenta\b/g, '70'],
  [/\bsesenta\b/g, '60'],
  [/\bcincuenta\b/g, '50'],
  [/\bcuarenta\b/g, '40'],
  [/\btreinta\b/g, '30'],
  [/\bveinte\b/g, '20'],
  [/\bquince\b/g, '15'],
  [/\bcatorce\b/g, '14'],
  [/\btrece\b/g, '13'],
  [/\bdoce\b/g, '12'],
  [/\bonce\b/g, '11'],
  [/\bdiez\b/g, '10'],
  [/\bciento\b/g, '100'],
  [/\bcien\b/g, '100'],
  [/\bmil\b/g, '1000'],
  [/\bcero\b/g, '0'],
  [/\bdos\b/g, '2'],
  [/\btres\b/g, '3'],
  [/\bcuatro\b/g, '4'],
  [/\bcinco\b/g, '5'],
  [/\bseis\b/g, '6'],
  [/\bsiete\b/g, '7'],
  [/\bocho\b/g, '8'],
  [/\bnueve\b/g, '9'],
];

/** Mínimo de dígitos seguidos o en total (ej. "312302"). */
const PHONE_MIN_DIGITS = 6;
/** Con pista de característica / localidad (AR): bloquear fragmentos cortos. */
const PHONE_MIN_DIGITS_WITH_AREA_HINT = 4;
/** Localidad + dígitos sueltos (evitar años tipo 2024). */
const PHONE_MIN_DIGITS_WITH_LOCALITY = 5;
/** Partes unidas con "y" / "e" que sumen este mínimo. */
const PHONE_MIN_SPLIT_DIGITS = 6;
/** Ej. "seis siete seis seis noventa" sin alcanzar 6 dígitos sueltos. */
const PHONE_MIN_NUMBER_WORDS = 4;

/** "Característica de San Nicolás y 312302", "prefijo 11 y …". */
const PHONE_AREA_HINT_RE =
  /\b(caracteristica|caracteristicas|codigo de area|prefijo|prefijo telefonico|clave telefonica|numero de area|nro de area|area telefonica)\b/i;

/** Localidades usadas para compartir código de área (Argentina). Texto ya normalizado sin tildes. */
const PHONE_LOCALITY_HINTS: readonly string[] = [
  'san nicolas',
  'san martin',
  'venado tuerto',
  'mar del plata',
  'bahia blanca',
  'la plata',
  'necochea',
  'tandil',
  'olavarria',
  'azul',
  'pergamino',
  'junin',
  'chivilcoy',
  'mercedes',
  'lujan',
  'moron',
  'san isidro',
  'tigre',
  'pilar',
  'escobar',
  'campana',
  'zarate',
  'rosario',
  'rafaela',
  'santa fe',
  'parana',
  'concordia',
  'corrientes',
  'posadas',
  'resistencia',
  'formosa',
  'salta',
  'tucuman',
  'santiago del estero',
  'la rioja',
  'catamarca',
  'san juan',
  'san luis',
  'mendoza',
  'san rafael',
  'neuquen',
  'comodoro rivadavia',
  'rio gallegos',
  'ushuaia',
  'cordoba',
  'villa maria',
  'rio cuarto',
  'capital federal',
  'caba',
  'buenos aires',
];

export function normalizeModerationText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte palabras-número a dígitos y devuelve solo la cadena numérica resultante. */
export function extractDigitsForPhoneCheck(normalized: string): string {
  let t = normalized;
  for (const [pattern, digit] of SPANISH_NUMBER_REPLACEMENTS) {
    t = t.replace(pattern, digit);
  }
  return t.replace(/[^0-9]/g, '');
}

function countSpanishNumberWords(normalized: string): number {
  const re = new RegExp(SPANISH_NUMBER_WORD.source, 'gi');
  let n = 0;
  while (re.exec(normalized) !== null) n += 1;
  return n;
}

function hasPhoneLocalityHint(normalized: string): boolean {
  return PHONE_LOCALITY_HINTS.some((loc) => normalized.includes(loc));
}

/** Al menos N dígitos consecutivos en el texto (sin contar espacios). */
function hasConsecutiveDigitRun(normalized: string, minLen = PHONE_MIN_DIGITS): boolean {
  return new RegExp(`\\d{${minLen},}`).test(normalized);
}

/** Varios grupos de dígitos unidos por "y" / "e" (ej. "11 y 1234 5678"). */
function sumSplitDigitGroups(normalized: string): number {
  const parts = normalized.split(/\s+(?:y|e)\s+/i);
  if (parts.length < 2) return 0;
  return parts.reduce((sum, part) => sum + part.replace(/[^0-9]/g, '').length, 0);
}

function matchPhoneAreaEvasion(
  normalized: string,
  digitStream: string,
): ContactModerationMatch | null {
  const digitLen = digitStream.length;
  if (digitLen === 0) return null;

  const areaHint = PHONE_AREA_HINT_RE.test(normalized);
  if (areaHint && digitLen >= PHONE_MIN_DIGITS_WITH_AREA_HINT) {
    return { code: 'telefono_caracteristica', detail: `${digitLen} dígitos con característica/área` };
  }

  if (hasPhoneLocalityHint(normalized) && digitLen >= PHONE_MIN_DIGITS_WITH_LOCALITY) {
    return { code: 'telefono_localidad', detail: `${digitLen} dígitos con localidad` };
  }

  const splitSum = sumSplitDigitGroups(normalized);
  if (splitSum >= PHONE_MIN_SPLIT_DIGITS && /\s+(?:y|e)\s+/i.test(normalized)) {
    return { code: 'telefono_partido', detail: `${splitSum} dígitos en partes` };
  }

  if (areaHint && splitSum >= PHONE_MIN_DIGITS_WITH_AREA_HINT) {
    return { code: 'telefono_caracteristica', detail: `${splitSum} dígitos partidos con área` };
  }

  return null;
}

function matchContactInfo(normalized: string): ContactModerationMatch | null {
  if (!normalized) return null;

  if (hasConsecutiveDigitRun(normalized)) {
    return { code: 'telefono_num', detail: '6+ dígitos seguidos' };
  }

  const digitStream = extractDigitsForPhoneCheck(normalized);
  if (digitStream.length >= PHONE_MIN_DIGITS) {
    return { code: 'telefono_num', detail: `${digitStream.length} dígitos` };
  }

  const areaEvasion = matchPhoneAreaEvasion(normalized, digitStream);
  if (areaEvasion) return areaEvasion;

  const numberWordCount = countSpanishNumberWords(normalized);
  if (numberWordCount >= PHONE_MIN_NUMBER_WORDS) {
    return { code: 'telefono_palabras', detail: `${numberWordCount} números en palabras` };
  }

  for (const rule of RULES) {
    if (rule.re.test(normalized)) {
      return { code: rule.code };
    }
  }

  return null;
}

export function validateContactInfo(textRaw: string): ContactModerationResult {
  const match = matchContactInfo(normalizeModerationText(textRaw));
  if (!match) {
    return { blocked: false, match: null, message: null };
  }
  return {
    blocked: true,
    match,
    message: CONTACT_MODERATION_POLICY_MESSAGE,
  };
}

export function detectBlockedContact(textRaw: string): BlockedContactMatch | null {
  const { match } = validateContactInfo(textRaw);
  if (!match) return null;
  return {
    keyword: match.code,
    reason: CONTACT_MODERATION_POLICY_MESSAGE,
  };
}

export type WorkerProfileTextModeration = {
  professional: ContactModerationResult;
  tradeDescriptions: ContactModerationResult[];
  hasViolation: boolean;
};

/** Valida descripción profesional y textos de cada oficio (perfil / registro). */
export function validateWorkerProfileTexts(
  professionalDescription: string,
  tradeDescriptions: string[],
): WorkerProfileTextModeration {
  const professional = validateContactInfo(professionalDescription);
  const tradeDescriptionsResults = tradeDescriptions.map((d) => validateContactInfo(d));
  return {
    professional,
    tradeDescriptions: tradeDescriptionsResults,
    hasViolation:
      professional.blocked || tradeDescriptionsResults.some((r) => r.blocked),
  };
}
