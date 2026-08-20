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

const POSTAL_CODE_RE = /^[A-Z]?\d{4}[A-Z]{0,3}$/i;

function isPostalCode(part: string): boolean {
  const compact = part.replace(/\s/g, '');
  return POSTAL_CODE_RE.test(compact) || /^\d{4,8}$/.test(compact);
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

/** Arma calle + barrio/localidad sin partido, provincia, CP ni país. */
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

/** Recorta un display_name de Nominatim eliminando partido, provincia, CP y país. */
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

/** Normaliza cualquier dirección guardada o mostrada en la app. */
export function normalizeDisplayAddress(address: string | null | undefined): string {
  const raw = (address ?? '').trim();
  if (!raw) return '';
  return formatShortAddress(raw);
}
