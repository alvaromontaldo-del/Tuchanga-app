import { DEFAULT_PHONE_COUNTRY_ID, PHONE_COUNTRIES } from '../data/phoneCountries';

/** Formato de email básico (frontend). */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function passwordsMatch(a: string, b: string): boolean {
  return a === b && a.length > 0;
}

/** Longitud mínima recomendada antes de conectar al backend. */
export function isStrongEnoughPassword(password: string, minLength = 6): boolean {
  return password.length >= minLength;
}

/** Solo dígitos para la parte nacional (sin prefijo internacional). */
export function sanitizeNationalPhoneDigits(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Formato visual tipo 9 364 565566 (celular AR con 9 a nivel país).
 * Referencia: +54 9 364 565566
 */
export function formatArgentinaNationalSpacing(digits: string): string {
  const d = sanitizeNationalPhoneDigits(digits);
  if (!d) return '';
  if (d.startsWith('9')) {
    const rest = d.slice(1);
    if (rest.length === 0) return '9';
    if (rest.length <= 3) return `9 ${rest}`;
    return `9 ${rest.slice(0, 3)} ${rest.slice(3)}`;
  }
  const chunks: string[] = [];
  let r = d;
  while (r.length > 0) {
    const take = r.length > 6 ? 3 : Math.min(4, r.length);
    chunks.push(r.slice(0, take));
    r = r.slice(take);
  }
  return chunks.join(' ');
}

/**
 * Valida la parte nacional según país. Devuelve mensaje de error o null si OK.
 * AR (celular): 9 + 9 u 10 dígitos (total 10–11), alineado al ejemplo +54 9 364 565566.
 */
export function validateNationalPhone(countryId: string, nationalDigits: string): string | null {
  const d = sanitizeNationalPhoneDigits(nationalDigits);
  if (!d) return 'El teléfono es obligatorio.';
  if (countryId === 'AR') {
    if (!/^9\d{9,10}$/.test(d)) {
      return 'Usá solo números. Celular: 9 + código de área + número (ej. 9 364 565566).';
    }
    return null;
  }
  if (d.length < 8 || d.length > 15) {
    return 'Revisá el largo del número (entre 8 y 15 dígitos).';
  }
  return null;
}

/**
 * Intenta separar país y dígitos nacionales desde el teléfono guardado (p. ej. +54 9 364 565566).
 */
export function parseStoredPhoneForEdit(phone: string): {
  countryId: string;
  nationalDigits: string;
} {
  const digits = sanitizeNationalPhoneDigits(phone);
  const sorted = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (digits.startsWith(c.dial) && digits.length > c.dial.length) {
      return { countryId: c.id, nationalDigits: digits.slice(c.dial.length) };
    }
  }
  return { countryId: DEFAULT_PHONE_COUNTRY_ID, nationalDigits: digits };
}

export function buildInternationalPhoneDisplay(
  dial: string,
  countryId: string,
  nationalDigits: string,
): string {
  const d = sanitizeNationalPhoneDigits(nationalDigits);
  if (countryId === 'AR') {
    return `+${dial} ${formatArgentinaNationalSpacing(d)}`;
  }
  return `+${dial} ${d}`;
}

const HAS_LETTER = /[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/;
const HAS_DIGIT = /\d/;

/** Contraseña con reglas de registro (frontend). */
export function getPasswordRegistrationError(password: string): string | undefined {
  if (password.length === 0) return 'La contraseña es obligatoria.';
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!HAS_LETTER.test(password)) return 'Incluí al menos una letra.';
  if (!HAS_DIGIT.test(password)) return 'Incluí al menos un número.';
  return undefined;
}
