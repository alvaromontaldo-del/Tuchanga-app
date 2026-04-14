export type PhoneCountry = {
  id: string;
  name: string;
  /** Sin + (ej. "54") */
  dial: string;
};

/** Argentina primero = predeterminado en registro. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { id: 'AR', name: 'Argentina', dial: '54' },
  { id: 'UY', name: 'Uruguay', dial: '598' },
  { id: 'CL', name: 'Chile', dial: '56' },
  { id: 'PY', name: 'Paraguay', dial: '595' },
  { id: 'BO', name: 'Bolivia', dial: '591' },
  { id: 'BR', name: 'Brasil', dial: '55' },
  { id: 'PE', name: 'Perú', dial: '51' },
  { id: 'CO', name: 'Colombia', dial: '57' },
  { id: 'MX', name: 'México', dial: '52' },
  { id: 'ES', name: 'España', dial: '34' },
  { id: 'US', name: 'Estados Unidos', dial: '1' },
] as const;

export const DEFAULT_PHONE_COUNTRY_ID = 'AR';

export function phoneCountryLabel(c: PhoneCountry): string {
  return `${c.name} (+${c.dial})`;
}

export function getPhoneCountryById(id: string): PhoneCountry | undefined {
  return PHONE_COUNTRIES.find((c) => c.id === id);
}
