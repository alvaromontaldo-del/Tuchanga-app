/** Extrae solo dígitos de un código de orden (acepta legacy #YACH-XXXX). */
export function normalizeOrderCodeInput(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Muestra el código sin prefijo #YACH-. */
export function formatOrderCodeDisplay(code: string | null | undefined): string {
  const digits = normalizeOrderCodeInput(code ?? '');
  return digits || '—';
}

export function normalizePinInput(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
  if (!digits) return '';
  return digits.padStart(4, '0');
}
