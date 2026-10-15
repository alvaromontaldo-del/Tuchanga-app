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

/** Mensaje del alta. `null` si el DNI (7–8) o el CUIT (11 + verificador) está completo. */
export function registrationDocumentError(
  type: AccountDocumentType,
  raw: string | null | undefined,
): string | null {
  const digits = onlyDigits(raw);
  if (type === 'cuit') {
    if (!digits) return 'El CUIT es obligatorio.';
    if (!isValidArgentineCuit(digits)) {
      return 'El CUIT debe tener 11 dígitos y un dígito verificador válido.';
    }
    return null;
  }
  if (!digits) return 'El DNI es obligatorio.';
  if (digits.length < 7 || digits.length > 8) return 'El DNI debe tener 7 u 8 dígitos.';
  return null;
}

/**
 * El check de términos y «Crear cuenta» usan la misma regla para DNI y CUIT.
 * Un CUIT de 11 dígitos no entra en el tope de 8 del DNI.
 */
export function isRegistrationDocumentReady(
  type: AccountDocumentType,
  raw: string | null | undefined,
): boolean {
  return registrationDocumentError(type, raw) == null;
}
