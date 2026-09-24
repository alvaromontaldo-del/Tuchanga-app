export type NominatimAddressParts = {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
};

const COUNTRY_NAMES = new Set([
  'argentina',
  'república argentina',
  'republica argentina',
]);

/**
 * CPA argentino tipico: C1414DHI (letra + 4 digitos + 3 letras).
 * NO tratar "1140" / "1414" sueltos como CP: en display_name de Nominatim
 * la altura suele venir como pieza separada ("Volta, 1140, Villa...").
 */
const CPA_RE = /^[A-Z]\d{4}[A-Z]{3}$/i;

function isPostalCode(part: string): boolean {
  const compact = part.replace(/\s/g, '');
  return CPA_RE.test(compact);
}

function isCountry(part: string): boolean {
  return COUNTRY_NAMES.has(part.trim().toLowerCase());
}

function isProvinceOrPartido(part: string): boolean {
  const lower = part.trim().toLowerCase();
  if (lower.startsWith('partido de ')) return true;
  if (lower.startsWith('provincia de ')) return true;
  if (lower.includes(' partido')) return true;
  if (lower.endsWith(' province') || lower.endsWith(' provincia')) return true;
  if (lower === 'buenos aires') return true;
  if (lower === 'provincia de buenos aires') return true;
  return false;
}

/** Arma calle + barrio/localidad sin partido, provincia, CP ni pais. */
export function buildShortAddressFromParts(parts: NominatimAddressParts): string | null {
  const road = parts.road ?? parts.pedestrian;
  const num = parts.house_number;
  const street = road ? (num ? `${road} ${num}` : road) : null;
  const locality =
    parts.neighbourhood ??
    parts.suburb ??
    parts.city ??
    parts.town ??
    parts.village ??
    parts.municipality;
  const joined = [street, locality].filter((x): x is string => Boolean(x?.trim()));
  return joined.length ? joined.join(', ') : null;
}

/** Recorta un display_name de Nominatim eliminando partido, provincia, CP y pais. */
export function formatShortAddress(full: string): string {
  const raw = (full ?? '').trim();
  if (!raw) return '';

  const pieces = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const kept = pieces.filter((part) => {
    if (isCountry(part)) return false;
    if (isPostalCode(part)) return false;
    if (isProvinceOrPartido(part)) return false;
    return true;
  });

  return kept.join(', ') || raw;
}

/** Normaliza cualquier direccion guardada o mostrada en la app. */
export function normalizeDisplayAddress(address: string | null | undefined): string {
  const raw = (address ?? '').trim();
  if (!raw) return '';
  return formatShortAddress(raw);
}