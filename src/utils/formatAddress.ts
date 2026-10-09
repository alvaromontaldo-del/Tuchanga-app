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
  /** Partido (Nominatim) o departamento (Georef). */
  county?: string;
  /** Provincia. */
  state?: string;
};

const COUNTRY_NAMES = new Set([
  'argentina',
  'república argentina',
  'republica argentina',
]);

/**
 * CPA argentino: C1414DHI (letra + 4 digitos + 3 letras) o el corto B2900.
 * NO tratar "1140" / "1414" sueltos como CP: en display_name de Nominatim
 * la altura suele venir como pieza separada ("Volta, 1140, Villa...").
 */
const CPA_RE = /^[A-Z]\d{4}(?:[A-Z]{3})?$/i;

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

function foldPiece(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function uniquePieces(pieces: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    const text = piece?.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = foldPiece(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * Partido para guardar, sin mostrarlo en la ficha.
 * «San Nicolás» queda «Partido de San Nicolás». Una comuna de CABA se deja como viene.
 */
export function formatPartido(county?: string | null, state?: string | null): string | null {
  const raw = county?.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const lower = foldPiece(raw);
  if (lower.startsWith('partido de ') || lower.startsWith('comuna')) return raw;
  const provincia = foldPiece(state ?? '');
  if (provincia.includes('ciudad autonoma') || provincia === 'caba') return raw;
  return `Partido de ${raw}`;
}

/**
 * Calle + barrio + localidad + partido + provincia.
 * Sin código postal ni país: Maps le agrega «, Argentina» solo en el fallback.
 */
export function buildCompleteAddress(
  parts: NominatimAddressParts,
  streetLine?: string | null,
): string {
  const road = parts.road?.trim() || parts.pedestrian?.trim() || '';
  const number = parts.house_number?.trim() || '';
  const fromParts = road ? (number ? `${road} ${number}` : road) : '';
  const street = streetLine?.trim() || fromParts;
  const barrio = parts.neighbourhood?.trim() || parts.suburb?.trim() || '';
  const localidad =
    parts.city?.trim() ||
    parts.town?.trim() ||
    parts.village?.trim() ||
    parts.municipality?.trim() ||
    '';
  return uniquePieces([
    street,
    barrio,
    localidad,
    formatPartido(parts.county, parts.state),
    parts.state,
  ]).join(', ');
}

/** display_name sin país ni código postal. Conserva localidad, partido y provincia. */
export function formatCompleteAddress(full: string | null | undefined): string {
  const raw = (full ?? '').trim();
  if (!raw) return '';
  const pieces = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !isCountry(part) && !isPostalCode(part));
  return pieces.join(', ');
}

/** Texto que se busca en Maps cuando no hay coordenadas. */
export function mapsQueryWithArgentina(address: string | null | undefined): string {
  const text = (address ?? '').trim();
  if (!text) return '';
  if (/\bargentina\b/i.test(text)) return text;
  return `${text}, Argentina`;
}