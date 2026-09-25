import {
  buildShortAddressFromParts,
  formatShortAddress,
  type NominatimAddressParts,
} from './formatAddress';

/** Calle + altura parseadas del texto que escribió el usuario. */
export type ParsedStreetQuery = {
  street: string;
  /** Altura tal como la escribió (puede incluir «bis»). */
  houseNumber: string;
  /** Piso, depto u otro resto después de la altura. */
  unit: string | null;
  /** Texto después de la primera coma (barrio, ciudad). */
  locality: string | null;
};

export type GeocodeHit = {
  id: string;
  lat: number;
  lng: number;
  displayName: string;
  parts: NominatimAddressParts;
  /** class de Nominatim (highway, place, amenity, …). */
  osmClass?: string;
};

export type RankedAddress = {
  id: string;
  address: string;
  lat: number;
  lng: number;
};

const NEAR_RADIUS_M = 35_000;

const UNIT_HEIGHT = /^\d{1,2}(?:[A-Za-z]{1,3})?$/;

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHeightToken(token: string): boolean {
  const compact = token.replace(/\s+/g, '');
  return /^\d{1,6}bis$/i.test(compact) || /^\d{1,6}[A-Za-z]?$/i.test(compact);
}

function isTrailingUnitToken(token: string): boolean {
  const compact = token.replace(/\s+/g, '');
  if (/^\d{1,6}bis$/i.test(compact)) return false;
  return UNIT_HEIGHT.test(compact);
}

function streetHasLetters(street: string): boolean {
  return fold(street).replace(/[^a-z]/g, '').length >= 2;
}

/**
 * Separa «Volta 1140», «Volta 1140 4B» o «Av. 9 de Julio 1200, Caballito».
 * Sin altura devuelve null (la búsqueda sigue siendo texto libre).
 */
export function parseStreetAddressQuery(query: string): ParsedStreetQuery | null {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const comma = trimmed.indexOf(',');
  const head = (comma >= 0 ? trimmed.slice(0, comma) : trimmed).trim();
  const locality = comma >= 0 ? trimmed.slice(comma + 1).trim() || null : null;
  if (!head) return null;

  const rawTokens = head.split(' ').filter(Boolean);
  const tokens: string[] = [];
  for (const token of rawTokens) {
    const prev = tokens[tokens.length - 1];
    if (/^bis$/i.test(token) && prev && isHeightToken(prev) && !/bis$/i.test(prev.replace(/\s+/g, ''))) {
      tokens[tokens.length - 1] = `${prev} bis`;
    } else {
      tokens.push(token);
    }
  }

  const heightIdxs: number[] = [];
  tokens.forEach((token, index) => {
    if (isHeightToken(token)) heightIdxs.push(index);
  });
  if (!heightIdxs.length) return null;

  let houseIdx = heightIdxs[heightIdxs.length - 1];
  if (heightIdxs.length >= 2 && isTrailingUnitToken(tokens[houseIdx])) {
    houseIdx = heightIdxs[heightIdxs.length - 2];
  }

  let street = tokens.slice(0, houseIdx).join(' ').trim();
  street = street.replace(/\s+(?:nro|nº|n°|num|numero|número|#)$/i, '').trim();
  if (!streetHasLetters(street)) return null;

  const houseNumber = tokens[houseIdx];
  const unit = tokens.slice(houseIdx + 1).join(' ').trim() || null;
  return { street, houseNumber, unit, locality };
}

/** Dígitos de la altura, para el parámetro street= de Nominatim. */
export function houseNumberDigits(houseNumber: string): string {
  return houseNumber.match(/\d+/)?.[0] ?? '';
}

export function houseNumbersMatch(a: string, b: string): boolean {
  const da = houseNumberDigits(a);
  const db = houseNumberDigits(b);
  return Boolean(da && db && da === db);
}

const STREET_PREFIX =
  /^(avenida|av|avda|calle|pasaje|pje|boulevard|bulevar|bv|bvd|ruta|camino|diagonal|diag)\s+/;
const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

function streetTokens(value: string): string[] {
  let folded = fold(value);
  if (STREET_PREFIX.test(folded)) folded = folded.replace(STREET_PREFIX, '');
  return folded.split(' ').filter((token) => token && !STOPWORDS.has(token));
}

/** 2 = mismo nombre; 1 = uno contiene al otro; 0 = no coincide. */
export function roadMatchScore(road: string | undefined, street: string): number {
  if (!road?.trim()) return 0;
  const a = streetTokens(road);
  const b = streetTokens(street);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 2;
  if (containsInOrder(a, b) || containsInOrder(b, a)) return 1;
  return 0;
}

function containsInOrder(hay: string[], needle: string[]): boolean {
  let index = 0;
  for (const token of hay) {
    if (token === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function localityTail(parts: NominatimAddressParts): string | null {
  const barrio = parts.neighbourhood?.trim() || parts.suburb?.trim() || '';
  const city = parts.city?.trim() || parts.town?.trim() || parts.village?.trim() || '';
  if (barrio && city && fold(barrio) !== fold(city)) return `${barrio}, ${city}`;
  return barrio || city || parts.municipality?.trim() || null;
}

function composeStreetLine(road: string, houseNumber: string, unit: string | null): string {
  const digits = houseNumberDigits(houseNumber);
  const already =
    Boolean(digits) && new RegExp(`\\b${escapeRegExp(digits)}\\b`).test(road);
  let line = already ? road.trim() : `${road.trim()} ${houseNumber}`.trim();
  if (unit && !line.toLowerCase().includes(unit.toLowerCase())) {
    line = `${line} ${unit}`;
  }
  return line;
}

function ensureHouseOnLabel(label: string, houseNumber: string, unit: string | null): string {
  const pieces = label.split(',').map((part) => part.trim()).filter(Boolean);
  if (!pieces.length) return '';
  const digits = houseNumberDigits(houseNumber);
  if (!digits || !new RegExp(`\\b${escapeRegExp(digits)}\\b`).test(pieces[0])) {
    pieces[0] = `${pieces[0]} ${houseNumber}`.trim();
  }
  if (unit && !pieces[0].toLowerCase().includes(unit.toLowerCase())) {
    pieces[0] = `${pieces[0]} ${unit}`;
  }
  return pieces.join(', ');
}

function formatNumberedHit(hit: GeocodeHit, parsed: ParsedStreetQuery): string {
  const road = (hit.parts.road ?? hit.parts.pedestrian ?? '').trim();
  if (road) {
    const line = composeStreetLine(road, parsed.houseNumber, parsed.unit);
    const tail = localityTail(hit.parts);
    return [line, tail].filter(Boolean).join(', ');
  }
  const fallback = formatShortAddress(hit.displayName);
  return ensureHouseOnLabel(fallback, parsed.houseNumber, parsed.unit);
}

function localityMatches(parts: NominatimAddressParts, locality: string | null): boolean {
  if (!locality) return false;
  const blob = fold(
    [parts.neighbourhood, parts.suburb, parts.city, parts.town, parts.village, parts.municipality]
      .filter(Boolean)
      .join(' '),
  );
  return locality
    .split(',')
    .map((piece) => fold(piece))
    .filter((piece) => piece.replace(/[^a-z]/g, '').length >= 3)
    .some((piece) => blob.includes(piece));
}

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function canUseAsStreetFallback(hit: GeocodeHit): boolean {
  const osmClass = hit.osmClass;
  if (!osmClass) return true;
  return osmClass === 'highway' || osmClass === 'place' || osmClass === 'boundary' || osmClass === 'building';
}

export function rawHitsIncludeRequestedHouse(hits: GeocodeHit[], parsed: ParsedStreetQuery): boolean {
  return hits.some((hit) => {
    const road = hit.parts.road ?? hit.parts.pedestrian;
    return (
      Boolean(hit.parts.house_number) &&
      houseNumbersMatch(hit.parts.house_number ?? '', parsed.houseNumber) &&
      roadMatchScore(road, parsed.street) >= 1
    );
  });
}

/**
 * Arma las sugerencias que ve el usuario.
 * Con altura: prioriza el portal real cercano. Si cerca solo existe la calle,
 * la etiqueta igual lleva la altura y, si hay un portal en otra ciudad, también se ofrece.
 */
export function rankGeocodeHits(
  hits: GeocodeHit[],
  query: string,
  near?: { lat: number; lng: number } | null,
): RankedAddress[] {
  const parsed = parseStreetAddressQuery(query);
  if (!parsed) {
    return hits
      .map((hit) => ({
        id: hit.id,
        lat: hit.lat,
        lng: hit.lng,
        address: buildShortAddressFromParts(hit.parts) || formatShortAddress(hit.displayName),
      }))
      .filter((hit) => hit.address.trim().length > 0)
      .slice(0, 6);
  }

  type Candidate = RankedAddress & {
    tier: number;
    distance: number;
    nameScore: number;
    localityRank: number;
    index: number;
  };

  const candidates: Candidate[] = [];
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index];
    const road = hit.parts.road ?? hit.parts.pedestrian;
    const nameScore = roadMatchScore(road, parsed.street);
    if (nameScore < 1) continue;

    const exact =
      Boolean(hit.parts.house_number) &&
      houseNumbersMatch(hit.parts.house_number ?? '', parsed.houseNumber);
    if (!exact && !canUseAsStreetFallback(hit)) continue;

    const distance = near ? distanceMeters(near, hit) : 0;
    const nearby = !near || distance <= NEAR_RADIUS_M;
    let tier = 3;
    if (exact && nearby) tier = 0;
    else if (!exact && nearby) tier = 1;
    else if (exact) tier = 2;
    if (tier === 3) continue;

    const address = formatNumberedHit(hit, parsed);
    if (!address.trim()) continue;
    candidates.push({
      id: hit.id,
      address,
      lat: hit.lat,
      lng: hit.lng,
      tier,
      distance,
      nameScore,
      localityRank: localityMatches(hit.parts, parsed.locality) ? 0 : 1,
      index,
    });
  }

  const hasNearbyExact = candidates.some((item) => item.tier === 0);
  // Con un portal cerca, no mezclar el centro de la calle ni alturas de otra provincia.
  // Si cerca solo está la calle, igual mostramos la altura lejana (punto real).
  let filtered = hasNearbyExact ? candidates.filter((item) => item.tier === 0) : candidates;
  const fallbacks = filtered.filter((item) => item.tier === 1);
  if (fallbacks.some((item) => item.nameScore === 2)) {
    filtered = filtered.filter((item) => item.tier !== 1 || item.nameScore === 2);
  }

  filtered.sort((a, b) => {
    if (a.localityRank !== b.localityRank) return a.localityRank - b.localityRank;
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.nameScore !== b.nameScore) return b.nameScore - a.nameScore;
    return a.index - b.index;
  });

  const seen = new Set<string>();
  const ranked: RankedAddress[] = [];
  for (const item of filtered) {
    const key = `${fold(item.address)}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({ id: item.id, address: item.address, lat: item.lat, lng: item.lng });
    if (ranked.length >= 6) break;
  }
  return ranked;
}
