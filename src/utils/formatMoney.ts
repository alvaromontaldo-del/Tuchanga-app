/**
 * Montos ARS en pesos enteros.
 * El agrupado es determinístico (punto cada 3 dígitos) y no usa Intl:
 * en Hermes, `es-AR` puede dejar sin separar los números de 4 dígitos
 * (`minimumGroupingDigits`). Acá 1000 es siempre "1.000".
 */

/** Redondeo hacia arriba a enteros no negativos (ARS). */
export function ceilMoneyArs(amount: number | string): number {
  return Math.max(0, Math.ceil(Number(amount) || 0));
}

const MAX_ARS_INPUT_DIGITS = 9;

function groupArsDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function digitsFromArsInput(raw: string, maxDigits = MAX_ARS_INPUT_DIGITS): string {
  const only = String(raw ?? '').replace(/\D/g, '');
  const trimmed = only.replace(/^0+(?=\d)/, '');
  return trimmed.slice(0, maxDigits);
}

/**
 * '$' + entero no negativo con '.' cada 3 dígitos.
 * 10.4 → $10, 10.5 → $11. NaN y negativos → $0.
 */
export function formatArs(amount: number | string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '$0';
  const entero = Math.max(0, Math.round(n));
  return `$${groupArsDigits(String(entero))}`;
}

/** Formatea un monto ARS como entero positivo con Math.ceil (sin decimales). */
export function formatMoneyCeilAr(amount: number | string): string {
  return formatArs(ceilMoneyArs(amount));
}

/**
 * Máscara en vivo: el usuario escribe 300000 y ve 300.000.
 * El valor que se guarda se obtiene con parseArsInput (sin los puntos).
 */
export function maskArsInput(raw: string, maxDigits = MAX_ARS_INPUT_DIGITS): string {
  const digits = digitsFromArsInput(raw, maxDigits);
  if (!digits) return '';
  return groupArsDigits(digits);
}

/** Entero limpio. "300.000" es 300000, no 300. Vacío → null. */
export function parseArsInput(text: string, maxDigits = MAX_ARS_INPUT_DIGITS): number | null {
  const digits = digitsFromArsInput(text, maxDigits);
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Texto de input para un monto ya numérico. Sin centavos (ceil, igual que la UI). */
export function amountToArsInput(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '';
  return maskArsInput(String(ceilMoneyArs(amount)));
}
