/** Extrae solo dígitos de un código de orden (acepta legacy #YACH-XXXX). */
export function normalizeOrderCodeInput(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Muestra el código sin prefijo #YACH-. */
export function formatOrderCodeDisplay(code: string | null | undefined): string {
  const digits = normalizeOrderCodeInput(code ?? '');
  return digits || '—';
}

/** Dígitos del PIN de retiro de materiales (y del PIN de trabajo). */
export const PIN_LENGTH = 4;

export function normalizePinInput(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, PIN_LENGTH);
  if (!digits) return '';
  return digits.padStart(PIN_LENGTH, '0');
}
