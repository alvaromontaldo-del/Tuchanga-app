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

function containsTokenSequence(line: string, token: string): boolean {
  const foldedLine = fold(line);
  const foldedToken = fold(token);
  if (!foldedToken) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(foldedToken)}(?:$|\\s)`).test(foldedLine);
}

function composeStreetLine(road: string, houseNumber: string, unit: string | null): string {
  const digits = houseNumberDigits(houseNumber);
  const already =
    Boolean(digits) && new RegExp(`\\b${escapeRegExp(digits)}\\b`).test(road);
  let line = already ? road.trim() : `${road.trim()} ${houseNumber}`.trim();
  if (unit && !containsTokenSequence(line, unit)) {
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
  if (unit && !containsTokenSequence(pieces[0], unit)) {
    pieces[0] = `${pieces[0]} ${unit}`;
  }
  return pieces.join(', ');
}

function splitAddressPieces(label: string): string[] {
  return label.split(',').map((part) => part.trim()).filter(Boolean);
}

/** Nombre de calle, sin un portal que venga adelante («1853 Volta») o atrás («Volta 1853»). */
function roadNameOnly(piece: string): string {
  const parsed = parseStreetAddressQuery(piece);
  if (parsed) return parsed.street;
  const tokens = piece.split(' ').filter(Boolean);
  if (tokens.length > 1 && isHeightToken(tokens[0].replace(/\s+/g, ''))) {
    return tokens.slice(1).join(' ').trim();
  }
  return piece.trim();
}

function preferredRoad(labelRoad: string, typedStreet: string): string {
  if (roadMatchScore(labelRoad, typedStreet) < 1) return labelRoad.trim();
  if (streetTokens(typedStreet).length > streetTokens(labelRoad).length) return typedStreet.trim();
  return labelRoad.trim();
}

function isStandalonePortalNumber(piece: string): boolean {
  return /^\d{1,6}(?:\s*bis)?$/i.test(piece.trim());
}

function ensureUnitOnFirstPiece(label: string, unit: string | null): string {
  if (!unit) return label;
  const pieces = splitAddressPieces(label);
  if (!pieces.length) return label;
  if (!containsTokenSequence(pieces[0], unit)) {
    pieces[0] = `${pieces[0]} ${unit}`;
  }
  return pieces.join(', ');
}

/**
 * Texto que hay que guardar al elegir una sugerencia.
 * Si la etiqueta ya trae la altura tipeada, se usa esa.
 * Si no, se mezcla calle + altura (+ piso/depto) del texto escrito.
 * No inventa altura cuando el usuario no escribió un número.
 * Un portal distinto de la misma calle (el más cercano en OSM) no reemplaza la altura tipeada.
 */
export function addressFromPick(typedQuery: string, suggestionLabel: string): string {
  const label = suggestionLabel.trim();
  const parsed = parseStreetAddressQuery(typedQuery);
  if (!parsed || !houseNumberDigits(parsed.houseNumber)) return label;

  if (!label) {
    const line = composeStreetLine(parsed.street, parsed.houseNumber, parsed.unit);
    return parsed.locality ? `${line}, ${parsed.locality}` : line;
  }

  if (labelHasHouseDigits(label, parsed.houseNumber)) {
    return ensureUnitOnFirstPiece(label, parsed.unit);
  }

  const pieces = splitAddressPieces(label);
  if (!pieces.length) {
    return composeStreetLine(parsed.street, parsed.houseNumber, parsed.unit);
  }

  const matchIdx = pieces.findIndex(
    (piece) => roadMatchScore(roadNameOnly(piece), parsed.street) >= 1,
  );
  if (matchIdx >= 0) {
    const name = preferredRoad(roadNameOnly(pieces[matchIdx]), parsed.street);
    pieces[matchIdx] = composeStreetLine(name, parsed.houseNumber, parsed.unit);
    return pieces
      .filter((piece, index) => index === matchIdx || !isStandalonePortalNumber(piece))
      .join(', ');
  }

  const headParsed = parseStreetAddressQuery(pieces[0]);
  const headHasOwnNumber = Boolean(headParsed && houseNumberDigits(headParsed.houseNumber));
  if (headHasOwnNumber) return label;

  const line = composeStreetLine(parsed.street, parsed.houseNumber, parsed.unit);
  return [line, ...pieces.slice(1)].join(', ');
}

/**
 * Dirección que se persiste.
 * Si el pin no se movió, gana la etiqueta confirmada al elegir (con la altura).
 * Si no hubo etiqueta, se reconstruye desde lo tipeado. Mover el pin a otra calle respeta el reverso.
 */
export function addressToPersist(options: {
  typedQuery?: string | null;
  confirmedLabel?: string | null;
  currentLabel: string;
  pinMoved: boolean;
}): string {
  const current = options.currentLabel.trim();
  if (!options.pinMoved) {
    const confirmed = options.confirmedLabel?.trim();
    if (confirmed) return confirmed;
    const typed = options.typedQuery?.trim();
    if (typed) return addressFromPick(typed, current);
  }
  return current;
}

/** Nombre de calle del hit. A veces Nominatim no manda `road` y el nombre está solo en display_name. */
function hitStreetName(hit: GeocodeHit): string {
  const fromParts = (hit.parts.road ?? hit.parts.pedestrian ?? '').trim();
  if (fromParts) return fromParts;
  return hit.displayName.split(',')[0]?.trim() ?? '';
}

function formatNumberedHit(hit: GeocodeHit, parsed: ParsedStreetQuery): string {
  const road = hitStreetName(hit);
  if (road && roadMatchScore(road, parsed.street) >= 1) {
    const line = composeStreetLine(road, parsed.houseNumber, parsed.unit);
    const tail = localityTail(hit.parts);
    return [line, tail].filter(Boolean).join(', ');
  }
  const fallback = formatShortAddress(hit.displayName);
  return ensureHouseOnLabel(fallback, parsed.houseNumber, parsed.unit);
}

function labelHasHouseDigits(address: string, houseNumber: string): boolean {
  const digits = houseNumberDigits(houseNumber);
  if (!digits) return false;
  return new RegExp(`\\b${escapeRegExp(digits)}\\b`).test(address);
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

/**
 * Hay una calle con ese nombre cerca del usuario (aunque no tenga portal).
 * Un portal lejano, como Volta 1140 en Alta Gracia, no cuenta.
 */
export function hitsIncludeNearbyStreet(
  hits: GeocodeHit[],
  parsed: ParsedStreetQuery,
  near?: { lat: number; lng: number } | null,
): boolean {
  return hits.some((hit) => {
    const road = hitStreetName(hit);
    if (roadMatchScore(road, parsed.street) < 1) return false;
    if (!near) return true;
    return distanceMeters(near, hit) <= NEAR_RADIUS_M;
  });
}

/**
 * Si el reverso de un punto sobre la calle pierde la altura, se la volvemos a poner.
 * Si el reverso es otra calle, se respeta.
 */
export function retainHouseNumber(selectedAddress: string, reversedAddress: string): string {
  const selected = selectedAddress.trim();
  const reversed = reversedAddress.trim();
  if (!selected || !reversed) return reversed || selected;
  const parsed = parseStreetAddressQuery(selected);
  if (!parsed || !houseNumberDigits(parsed.houseNumber)) return reversed;
  const pieces = splitAddressPieces(reversed);
  const sameStreet = pieces.some(
    (piece) => roadMatchScore(roadNameOnly(piece), parsed.street) >= 1,
  );
  if (!sameStreet) return reversed;
  return addressFromPick(selected, reversed);
}

/**
 * Arma las sugerencias que ve el usuario.
 * Con altura: si hay portal cerca, usa ese punto. Si OSM solo tiene la calle,
 * la etiqueta y lo que se guarda llevan igual la altura tipeada (el pin queda en la calle).
 * Un portal en otra ciudad no reemplaza esa calle.
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
    const road = hitStreetName(hit);
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

  let filtered = candidates;
  if (parsed.locality) {
    const inCity = candidates.filter((item) => item.localityRank === 0);
    if (inCity.length) filtered = inCity;
  }

  const hasNearbyExact = filtered.some((item) => item.tier === 0);
  const hasNearbyStreet = filtered.some((item) => item.tier === 1);
  if (hasNearbyExact) {
    filtered = filtered.filter((item) => item.tier === 0);
  } else if (hasNearbyStreet) {
    // Sin portal en la zona: la calle cercana, con la altura que escribió la persona.
    // No sumar un portal de otra ciudad (Volta 1140 en Alta Gracia).
    filtered = filtered.filter((item) => item.tier === 1);
  }
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
  return ensureTypedHeightSuggestion(ranked, hits, parsed, near);
}

/**
 * Si la lista no muestra la altura tipeada, arma una sugerencia con esa altura
 * y el punto de la calle (centro de calle si OSM no tiene el portal).
 */
export function ensureTypedHeightSuggestion(
  ranked: RankedAddress[],
  hits: GeocodeHit[],
  parsed: ParsedStreetQuery,
  near?: { lat: number; lng: number } | null,
): RankedAddress[] {
  const withNumber = ranked.map((item) => {
    if (labelHasHouseDigits(item.address, parsed.houseNumber)) return item;
    const hit = hits.find((candidate) => candidate.id === item.id);
    if (!hit || roadMatchScore(hitStreetName(hit), parsed.street) < 1) return item;
    const address = formatNumberedHit(hit, parsed);
    return address.trim() ? { ...item, address } : item;
  });
  if (withNumber.some((item) => labelHasHouseDigits(item.address, parsed.houseNumber))) {
    return withNumber;
  }

  const streets = hits.filter(
    (hit) => canUseAsStreetFallback(hit) && roadMatchScore(hitStreetName(hit), parsed.street) >= 1,
  );
  if (!streets.length) return withNumber;

  const best = [...streets].sort((a, b) => {
    const aNear = !near || distanceMeters(near, a) <= NEAR_RADIUS_M ? 0 : 1;
    const bNear = !near || distanceMeters(near, b) <= NEAR_RADIUS_M ? 0 : 1;
    if (aNear !== bNear) return aNear - bNear;
    const score = roadMatchScore(hitStreetName(b), parsed.street) - roadMatchScore(hitStreetName(a), parsed.street);
    if (score !== 0) return score;
    if (!near) return 0;
    return distanceMeters(near, a) - distanceMeters(near, b);
  })[0];
  const address = formatNumberedHit(best, parsed);
  if (!labelHasHouseDigits(address, parsed.houseNumber)) return withNumber;
  return [
    { id: `altura-${houseNumberDigits(parsed.houseNumber)}`, address, lat: best.lat, lng: best.lng },
    ...withNumber,
  ].slice(0, 6);
}
