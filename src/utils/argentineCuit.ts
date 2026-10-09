/** Tipo de documento de la cuenta. El número vive en `profiles.dni`. */
export type AccountDocumentType = 'dni' | 'cuit';

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

export function onlyDigits(input: string | null | undefined): string {
  return String(input ?? '').replace(/\D/g, '');
}

/**
 * CUIT/CUIL argentino: 11 dígitos y dígito verificador módulo 11.
 * Serie 5,4,3,2,7,6,5,4,3,2. Resto 0 → 0. Resto 1 → 9. Si no, 11 − resto.
 */
export function isValidArgentineCuit(input: string | null | undefined): boolean {
  const digits = onlyDigits(input);
  if (!/^\d{11}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(digits[i]) * CUIT_WEIGHTS[i];
  }
  const mod = sum % 11;
  let expected = 11 - mod;
  if (expected === 11) expected = 0;
  else if (expected === 10) expected = 9;
  return Number(digits[10]) === expected;
}

/** Máscara XX-XXXXXXXX-X mientras se escribe. */
export function formatArgentineCuit(input: string | null | undefined): string {
  const digits = onlyDigits(input).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

/**
 * Ya hay un documento cargado (DNI de 7–8 o CUIT de 11).
 * Un valor vacío o el placeholder `0` de cuentas viejas todavía se puede cargar una vez.
 */
export function documentNumberIsLocked(input: string | null | undefined): boolean {
  return onlyDigits(input).length >= 7;
}
