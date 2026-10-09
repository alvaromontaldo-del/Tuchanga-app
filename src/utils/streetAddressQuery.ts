import {
  buildCompleteAddress,
  buildShortAddressFromParts,
  formatCompleteAddress,
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
  /**
   * interpolated: Georef ubicó esa altura.
   * anchored: no hay portal; el punto es la altura conocida más cercana (Chiclana 148 ≈ 200).
   * portal: Nominatim trae house_number.
   * approximate: centro de un tramo, sin numeración.
   */
  positionQuality?: 'interpolated' | 'anchored' | 'portal' | 'approximate';
  /** Id de calle en Georef, para reconocer el mismo eje. */
  streetId?: string;
  /** Rango de alturas de esa calle en esa localidad, si lo conocemos. */
  heightRange?: StreetHeightRange | null;
};

/** Altura inicial y final de una calle según el padrón (Georef / INDEC). */
export type StreetHeightRange = { min: number; max: number };

/** Rango de una calle en una localidad, para no aplicar el de San Nicolás a otra ciudad. */
export type LocalityStreetRange = {
  locality: string;
  streetName: string;
  streetId: string;
  range: StreetHeightRange;
};

export type RankedAddress = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  /**
   * Etiqueta OSM sin la altura que escribió la persona.
   * La fila visible se arma desde acá, así un resultado viejo (solo calle)
   * muestra el número del campo y, si lo borra, no queda inventado.
   */
  plainAddress?: string;
  /**
   * Calle, localidad, partido y provincia. No se muestra en la ficha:
   * se guarda para el pin y para el fallback de Maps.
   */
  completeAddress?: string;
};

const NEAR_RADIUS_M = 35_000;
/**
 * Dos puntos de la misma calle y la misma altura, más cerca que esto, son el mismo lugar
 * (el padrón a veces parte un portal en varios vértices). Más lejos, son direcciones distintas:
 * Volta 1140 en San Nicolás tiene dos tramos a ~1,5 km y hay que mostrar los dos.
 */
const SAME_PLACE_M = 180;
/** Tope de una altura urbana en Argentina. Por encima, no se inventa un pin. */
const MAX_PLAUSIBLE_HOUSE_NUMBER = 30_000;

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

/**
 * Altura que se puede apoyar en el eje de la calle cuando OSM no tiene el portal.
 * 1140 y 148 entran. 123555 no: no es un domicilio y no hay que inventarle coordenadas.
 */
export function isPlausibleHouseNumber(houseNumber: string): boolean {
  const digits = houseNumberDigits(houseNumber);
  if (!/^[1-9]\d{0,4}$/.test(digits)) return false;
  const value = Number(digits);
  return value >= 1 && value <= MAX_PLAUSIBLE_HOUSE_NUMBER;
}

const IMPLAUSIBLE_HEIGHT_MESSAGE =
  'No encontramos esa altura en el mapa. Revisá el número: no se puede guardar una dirección inventada.';
const ABOVE_STREET_END_MESSAGE =
  'No encontramos esa altura en el mapa. Revisá el número: esa calle no llega tan alto.';

/** Consultas cuya altura quedó por encima del final de la calle en la zona del usuario. */
const heightsAboveStreetEnd = new Set<string>();

function rejectionKey(query: string): string {
  return fold(query);
}

/** La última búsqueda marcó (o desmarcó) que esa altura se pasa del final de la calle. */
export function noteAddressHeightRejection(query: string, rejected: boolean): void {
  const key = rejectionKey(query);
  if (!key) return;
  if (rejected) heightsAboveStreetEnd.add(key);
  else heightsAboveStreetEnd.delete(key);
}

export function clearAddressHeightRejections(): void {
  heightsAboveStreetEnd.clear();
}

function heightRejectionNoted(query: string): boolean {
  const key = rejectionKey(query);
  return Boolean(key) && heightsAboveStreetEnd.has(key);
}

/**
 * true si el número está por encima del final de todas las calles conocidas.
 * Sin rangos no se rechaza: un mínimo alto (Volta en Las Cañitas arranca en 1801 en el padrón
 * pero la calle sigue en el mapa) no alcanza para descartar la altura.
 */
export function isHouseNumberAboveStreetEnd(
  houseNumber: string,
  ranges: StreetHeightRange[] | null | undefined,
): boolean {
  if (!ranges || ranges.length === 0) return false;
  const digits = houseNumberDigits(houseNumber);
  const value = Number(digits);
  if (!Number.isFinite(value)) return false;
  const maxEnd = Math.max(...ranges.map((range) => range.max));
  return value > maxEnd;
}

/** Aviso cuando el número tipeado no se puede tratar como una dirección real. */
export function rejectedAddressMessage(
  query: string,
  ranges?: StreetHeightRange[] | null,
): string | null {
  const parsed = parseStreetAddressQuery(query.trim());
  if (!parsed || !houseNumberDigits(parsed.houseNumber)) return null;
  if (!isPlausibleHouseNumber(parsed.houseNumber)) return IMPLAUSIBLE_HEIGHT_MESSAGE;
  if (ranges && ranges.length > 0) {
    return isHouseNumberAboveStreetEnd(parsed.houseNumber, ranges) ? ABOVE_STREET_END_MESSAGE : null;
  }
  if (heightRejectionNoted(query)) return ABOVE_STREET_END_MESSAGE;
  return null;
}

/** Texto cuando la búsqueda de una dirección no devolvió sugerencias. */
export function emptyAddressSearchMessage(query: string): string {
  return (
    rejectedAddressMessage(query) ??
    'No encontramos esa dirección. Revisá calle y altura, o probá con la localidad.'
  );
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

function hitCityName(parts: NominatimAddressParts): string | null {
  return parts.city?.trim() || parts.town?.trim() || parts.village?.trim() || null;
}

function hitBarrioName(parts: NominatimAddressParts): string | null {
  return parts.neighbourhood?.trim() || parts.suburb?.trim() || null;
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

function queryHasHouseNumber(text: string): boolean {
  const parsed = parseStreetAddressQuery(text);
  return Boolean(parsed && houseNumberDigits(parsed.houseNumber));
}

/**
 * Texto del campo que hay que usar para rotular sugerencias.
 * Si el campo visible trae altura, gana sobre un recuerdo anterior sin número.
 */
export function activeStreetQuery(fieldText: string, remembered?: string | null): string {
  const field = fieldText.trim();
  const memory = remembered?.trim() ?? '';
  if (queryHasHouseNumber(field)) return field;
  if (memory && queryHasHouseNumber(memory)) return memory;
  return field || memory;
}

/** Etiqueta de una fila del autocomplete. Con altura tipeada, la muestra; sin altura, no inventa. */
export function suggestionLabel(typedQuery: string, rawLabel: string): string {
  return addressFromPick(typedQuery, rawLabel);
}

export function stampSuggestions<T extends { address: string; completeAddress?: string }>(
  query: string,
  items: T[],
): T[] {
  const parsed = parseStreetAddressQuery(query);
  if (!parsed || !houseNumberDigits(parsed.houseNumber)) return items;
  return items.map((item) => {
    const address = addressFromPick(query, item.address);
    const completeAddress = item.completeAddress
      ? addressFromPick(query, item.completeAddress)
      : item.completeAddress;
    if (address === item.address && completeAddress === item.completeAddress) return item;
    return { ...item, address, completeAddress };
  });
}

function pieceCount(value: string): number {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean).length;
}

/**
 * Dirección completa del resultado elegido.
 * Si el display_name trae partido y provincia, gana sobre un parts corto.
 * La altura tipeada se estampa en la primera calle.
 */
export function completeAddressForHit(hit: GeocodeHit, streetLine?: string | null): string {
  const fromParts = buildCompleteAddress(hit.parts);
  const fromDisplay = formatCompleteAddress(hit.displayName);
  const base = pieceCount(fromDisplay) >= pieceCount(fromParts) ? fromDisplay : fromParts;
  const street = streetLine?.trim() || '';
  const stamped = street ? addressFromPick(street, base) : base;
  return stamped.trim();
}

/** Lo que se persiste en profiles.direccion_completa al confirmar la sugerencia. */
export function exactAddressToSave(
  savedAddress: string,
  completeAddress?: string | null,
): string | null {
  const complete = completeAddress?.trim() ?? '';
  if (!complete) return null;
  const stamped = addressFromPick(savedAddress, complete).trim();
  return stamped || null;
}

/**
 * Texto de una fila del listado, usando el campo visible.
 * `plainAddress` es la calle OSM sin número inyectado: si el campo no trae altura, no se inventa.
 */
export function visibleSuggestionAddress(
  fieldText: string,
  remembered: string | null | undefined,
  row: { address: string; plainAddress?: string | null },
): string {
  const query = activeStreetQuery(fieldText, remembered);
  const base = row.plainAddress?.trim() || row.address;
  return suggestionLabel(query, base);
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

  // Un número imposible, o más alto que el final de la calle, no se pega sobre
  // una calle que el geocoder no numeró. Si el resultado ya trae esa altura, se conserva.
  if (rejectedAddressMessage(typedQuery)) {
    if (!label || !labelHasHouseDigits(label, parsed.houseNumber)) return label;
    return ensureUnitOnFirstPiece(label, parsed.unit);
  }

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

function reapplyTypedHeight(label: string, typedQuery: string): string {
  const typed = typedQuery.trim();
  if (!typed) return label;
  const parsed = parseStreetAddressQuery(typed);
  if (!parsed || !houseNumberDigits(parsed.houseNumber)) return label;
  if (labelHasHouseDigits(label, parsed.houseNumber)) {
    return ensureUnitOnFirstPiece(label, parsed.unit);
  }
  return addressFromPick(typed, label);
}

/**
 * Dirección que se persiste.
 * La altura tipeada manda sobre el centro de calle o un portal cercano de OSM
 * mientras la calle sea la misma. Mover el pin a otra calle respeta ese reverso.
 * Si nadie escribió un número, no se inventa.
 */
export function addressToPersist(options: {
  typedQuery?: string | null;
  confirmedLabel?: string | null;
  currentLabel: string;
  pinMoved: boolean;
}): string {
  const current = options.currentLabel.trim();
  const typed = options.typedQuery?.trim() ?? '';
  const confirmed = options.confirmedLabel?.trim() ?? '';

  if (!options.pinMoved) {
    if (confirmed) return reapplyTypedHeight(confirmed, typed);
    if (typed) return addressFromPick(typed, current);
    return current;
  }

  const anchor = confirmed || typed;
  if (!anchor) return current;
  return retainHouseNumber(anchor, current);
}

/** El TextInput repitió el valor que acabamos de escribir desde código. */
export function isIgnorableAddressEcho(
  nextText: string,
  programmaticLabel: string | null | undefined,
  typedQuery: string | null | undefined,
  nowMs: number,
  echoUntilMs: number,
): boolean {
  const next = nextText.trim();
  const programmatic = programmaticLabel?.trim() ?? '';
  if (programmatic && next === programmatic) return true;
  if (nowMs >= echoUntilMs) return false;
  if (!next) return true;
  const typed = typedQuery?.trim() ?? '';
  return Boolean(typed) && next === typed;
}

const PIN_JITTER_M = 25;

/** Un “move” del mapa al centrar el pin no es un arrastre del usuario. */
export function isNegligiblePinMove(
  from: { lat: number; lng: number } | null | undefined,
  to: { lat: number; lng: number },
): boolean {
  if (!from) return false;
  return distanceMeters(from, to) < PIN_JITTER_M;
}

/**
 * Si el nombre completo no está cerca (Alejandro Volta vs la calle Volta),
 * buscamos también el último token. No aplica a calles cuyo nombre ya trae un número.
 */
export function fallbackStreetNames(street: string): string[] {
  const foldedTokens = streetTokens(street);
  if (foldedTokens.length < 2) return [];
  if (foldedTokens.some((token) => /^\d+$/.test(token))) return [];
  const lastFold = foldedTokens[foldedTokens.length - 1] ?? '';
  if (lastFold.length < 4) return [];
  const rawTokens = street.trim().split(/\s+/).filter(Boolean);
  const lastRaw = [...rawTokens].reverse().find((token) => fold(token) === lastFold);
  if (!lastRaw || fold(lastRaw) === fold(street)) return [];
  return [lastRaw];
}

/** Nombre de calle del hit. A veces Nominatim no manda `road` y el nombre está solo en display_name. */
function hitStreetName(hit: GeocodeHit): string {
  const fromParts = (hit.parts.road ?? hit.parts.pedestrian ?? '').trim();
  if (fromParts) return fromParts;
  return hit.displayName.split(',')[0]?.trim() ?? '';
}

function plainHitAddress(hit: GeocodeHit): string {
  return (buildShortAddressFromParts(hit.parts) || formatShortAddress(hit.displayName)).trim();
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
  radiusM = NEAR_RADIUS_M,
): boolean {
  return hits.some((hit) => {
    const road = hitStreetName(hit);
    if (roadMatchScore(road, parsed.street) < 1) return false;
    if (!near) return true;
    return distanceMeters(near, hit) <= radiusM;
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

type PositionQuality = NonNullable<GeocodeHit['positionQuality']>;

type PlaceCandidate = RankedAddress & {
  tier: number;
  distance: number;
  nameScore: number;
  localityRank: number;
  index: number;
  streetKey: string;
  houseDigits: string;
  quality: PositionQuality;
  streetId: string | null;
  roadName: string;
  cityName: string | null;
  barrioName: string | null;
  streetLine: string;
};

const QUALITY_RANK: Record<PositionQuality, number> = {
  interpolated: 0,
  portal: 1,
  anchored: 2,
  approximate: 3,
};

function sameCityName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const fa = fold(a);
  const fb = fold(b);
  if (fa === fb) return true;
  const caba = (value: string) =>
    value === 'buenos aires' || value === 'caba' || value.includes('ciudad autonoma');
  return caba(fa) && caba(fb);
}

function sameStreetCandidate(a: PlaceCandidate, b: PlaceCandidate): boolean {
  if (a.streetId && b.streetId && a.streetId === b.streetId) return true;
  if (a.streetKey && a.streetKey === b.streetKey) return true;
  return roadMatchScore(a.roadName, b.roadName) >= 1;
}

/**
 * Solo junta copias del mismo lugar (vértices a ≤ 180 m).
 * El pin no sigue al usuario: entre copias gana la posición interpolada
 * y, si empatan, el punto más cercano al centro del grupo.
 * El barrio del elegido se conserva.
 */
function collapseNearDuplicatePlaces(items: PlaceCandidate[]): PlaceCandidate[] {
  const clusters: PlaceCandidate[][] = [];
  for (const item of items) {
    const cluster = clusters.find(
      (group) =>
        group[0].houseDigits === item.houseDigits &&
        group.some(
          (member) => sameStreetCandidate(member, item) && distanceMeters(member, item) <= SAME_PLACE_M,
        ),
    );
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }

  return clusters.map((cluster) => {
    const bestRank = Math.min(...cluster.map((item) => QUALITY_RANK[item.quality]));
    const pool = cluster.filter((item) => QUALITY_RANK[item.quality] === bestRank);
    if (pool.length === 1) return pool[0];
    const centroid = {
      lat: pool.reduce((sum, item) => sum + item.lat, 0) / pool.length,
      lng: pool.reduce((sum, item) => sum + item.lng, 0) / pool.length,
    };
    return pool.reduce((best, item) =>
      distanceMeters(item, centroid) < distanceMeters(best, centroid) ? item : best,
    );
  });
}

function hitQuality(hit: GeocodeHit, exactPortal: boolean): PositionQuality {
  if (hit.positionQuality) return hit.positionQuality;
  return exactPortal ? 'portal' : 'approximate';
}

/** true si esta altura se pasa del final conocido de ESA calle. */
function hitAboveStreetEnd(hit: GeocodeHit, houseNumber: string): boolean {
  return isHouseNumberAboveStreetEnd(houseNumber, hit.heightRange ? [hit.heightRange] : null);
}

/**
 * Arma las sugerencias que ve el usuario.
 * Si hay una posición interpolada o anclada a la altura (Georef), esa gana sobre el
 * centro del tramo, y no se mueve cuando el usuario cambia de cuadra en la misma ciudad.
 * Dos lugares de verdad (otra localidad, o a más de ~180 m) se listan los dos, con barrio.
 * Una altura imposible (Garibaldi 123555) o más alta que el final de la calle no fabrica pin.
 * Un portal en otra ciudad no reemplaza la calle de al lado.
 */
export function rankGeocodeHits(
  hits: GeocodeHit[],
  query: string,
  near?: { lat: number; lng: number } | null,
): RankedAddress[] {
  const parsed = parseStreetAddressQuery(query);
  if (!parsed) {
    return hits
      .map((hit) => {
        const address = buildShortAddressFromParts(hit.parts) || formatShortAddress(hit.displayName);
        return {
          id: hit.id,
          lat: hit.lat,
          lng: hit.lng,
          address,
          plainAddress: address,
          completeAddress: completeAddressForHit(hit, address),
        };
      })
      .filter((hit) => hit.address.trim().length > 0)
      .slice(0, 6);
  }

  const candidates: PlaceCandidate[] = [];
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index];
    const road = hitStreetName(hit);
    const nameScore = roadMatchScore(road, parsed.street);
    if (nameScore < 1) continue;

    const exactPortal =
      Boolean(hit.parts.house_number) &&
      houseNumbersMatch(hit.parts.house_number ?? '', parsed.houseNumber);
    const quality = hitQuality(hit, exactPortal);
    if (quality === 'approximate' && !canUseAsStreetFallback(hit)) continue;
    // Sin portal confirmado, una altura absurda no se estampa en el centro de la calle.
    if (quality === 'approximate' && !isPlausibleHouseNumber(parsed.houseNumber)) continue;
    // Chiclana 9000 / Garibaldi 5000: la calle no llega. Volta 1140 con padrón 1801–1900 sí,
    // porque el número no se pasa del final (el mínimo alto suele ser un hueco del padrón).
    if (quality === 'approximate' && hitAboveStreetEnd(hit, parsed.houseNumber)) continue;

    const distance = near ? distanceMeters(near, hit) : 0;
    const nearby = !near || distance <= NEAR_RADIUS_M;
    const positioned = quality !== 'approximate';
    let tier = 3;
    if (positioned && nearby) tier = 0;
    else if (!positioned && nearby) tier = 1;
    else if (positioned) tier = 2;
    if (tier === 3) continue;

    const address = formatNumberedHit(hit, parsed);
    if (!address.trim()) continue;
    candidates.push({
      id: hit.id,
      address,
      plainAddress: plainHitAddress(hit),
      lat: hit.lat,
      lng: hit.lng,
      tier,
      distance,
      nameScore,
      localityRank: localityMatches(hit.parts, parsed.locality) ? 0 : 1,
      index,
      streetKey: streetTokens(road).join(' '),
      houseDigits: houseNumberDigits(parsed.houseNumber),
      quality,
      streetId: hit.streetId ?? null,
      roadName: road,
      cityName: hitCityName(hit.parts),
      barrioName: hitBarrioName(hit.parts),
      streetLine: composeStreetLine(road, parsed.houseNumber, parsed.unit),
      completeAddress: completeAddressForHit(hit, address),
    });
  }

  const positionedHits = candidates.filter((item) => item.quality !== 'approximate');
  const withoutWorseCentroids = candidates.filter((item) => {
    if (item.quality !== 'approximate') return true;
    return !positionedHits.some(
      (placed) =>
        placed.houseDigits === item.houseDigits &&
        sameStreetCandidate(placed, item) &&
        (sameCityName(placed.cityName, item.cityName) || distanceMeters(placed, item) <= 450),
    );
  });
  candidates.length = 0;
  candidates.push(...withoutWorseCentroids);

  // Si acá la calle no llega (Garibaldi termina en 2799), no rescatar un portal
  // de otra provincia que Nominatim numeró con esa altura.
  const localStreetEndsBeforeNumber = hits.some((hit) => {
    if (roadMatchScore(hitStreetName(hit), parsed.street) < 1) return false;
    if (!hitAboveStreetEnd(hit, parsed.houseNumber)) return false;
    if (!near) return true;
    return distanceMeters(near, hit) <= NEAR_RADIUS_M;
  });
  if (localStreetEndsBeforeNumber) {
    const inZone = candidates.filter((item) => item.tier < 2);
    candidates.length = 0;
    candidates.push(...inZone);
  }

  let filtered: PlaceCandidate[] = candidates;
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
  // Un homónimo exacto lejos (Alejandro Volta en Tigre) no esconde la calle de al lado
  // que OSM nombra más corto (Volta en Palermo).
  const CLOSE_NAME_RADIUS_M = 8_000;
  const closeExactName = filtered.some(
    (item) => item.tier === 1 && item.nameScore === 2 && item.distance <= CLOSE_NAME_RADIUS_M,
  );
  if (closeExactName) {
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
  for (const item of collapseNearDuplicatePlaces(filtered)) {
    const key = `${fold(item.address)}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push({
      id: item.id,
      address: item.address,
      plainAddress: item.plainAddress,
      lat: item.lat,
      lng: item.lng,
      completeAddress: item.completeAddress,
    });
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
  if (!isPlausibleHouseNumber(parsed.houseNumber)) {
    return ranked.filter(
      (item) =>
        labelHasHouseDigits(item.address, parsed.houseNumber) ||
        labelHasHouseDigits(item.plainAddress ?? '', parsed.houseNumber),
    );
  }

  const withNumber = ranked.map((item) => {
    if (labelHasHouseDigits(item.address, parsed.houseNumber)) return item;
    const hit = hits.find((candidate) => candidate.id === item.id);
    if (!hit || roadMatchScore(hitStreetName(hit), parsed.street) < 1) return item;
    const address = formatNumberedHit(hit, parsed);
    if (!address.trim()) return item;
    return {
      ...item,
      address,
      completeAddress: item.completeAddress
        ? addressFromPick(address, item.completeAddress)
        : completeAddressForHit(hit, address),
    };
  });
  if (withNumber.some((item) => labelHasHouseDigits(item.address, parsed.houseNumber))) {
    return withNumber;
  }

  const matching = hits.filter(
    (hit) => canUseAsStreetFallback(hit) && roadMatchScore(hitStreetName(hit), parsed.street) >= 1,
  );
  // Si la calle de al lado no llega a esa altura, no la inventamos en otro pueblo.
  const nearbyBlocked = matching.some((hit) => {
    const nearEnough = !near || distanceMeters(near, hit) <= NEAR_RADIUS_M;
    return nearEnough && hitAboveStreetEnd(hit, parsed.houseNumber);
  });
  const streets = matching.filter((hit) => {
    if (hitAboveStreetEnd(hit, parsed.houseNumber)) return false;
    if (!nearbyBlocked) return true;
    const nearEnough = !near || distanceMeters(near, hit) <= NEAR_RADIUS_M;
    return nearEnough && Boolean(hit.heightRange);
  });
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
    {
      id: `altura-${houseNumberDigits(parsed.houseNumber)}`,
      address,
      plainAddress: plainHitAddress(best),
      lat: best.lat,
      lng: best.lng,
      completeAddress: completeAddressForHit(best, address),
    },
    ...withNumber,
  ].slice(0, 6);
}

const ENRICH_RADIUS_M = 700;

/**
 * Completa barrio y nombre de calle (Felipe Chiclana, Alejandro Volta) con el tramo
 * de OSM más cercano a cada punto interpolado, para que dos Volta 1140 se distingan.
 */
export function enrichPositionedHits(positioned: GeocodeHit[], osmHits: GeocodeHit[]): GeocodeHit[] {
  const usedBarrios = new Set<string>();
  return positioned.map((hit) => {
    const road = hitStreetName(hit);
    const options = osmHits
      .map((osm) => ({ osm, distance: distanceMeters(hit, osm) }))
      .filter(
        ({ osm, distance }) =>
          distance <= ENRICH_RADIUS_M && roadMatchScore(hitStreetName(osm), road) >= 1,
      )
      .sort((a, b) => a.distance - b.distance);
    if (!options.length) return hit;
    const picked =
      options.find(({ osm }) => {
        const barrio = fold(osm.parts.neighbourhood || osm.parts.suburb || '');
        return Boolean(barrio) && !usedBarrios.has(barrio);
      }) ?? options[0];
    const barrioName = picked.osm.parts.neighbourhood || picked.osm.parts.suburb || '';
    if (barrioName) usedBarrios.add(fold(barrioName));
    const osmRoad = hitStreetName(picked.osm);
    const useOsmRoad =
      Boolean(osmRoad) &&
      roadMatchScore(osmRoad, road) >= 1 &&
      streetTokens(osmRoad).length >= streetTokens(road).length;
    return {
      ...hit,
      parts: {
        ...hit.parts,
        road: useOsmRoad ? osmRoad : hit.parts.road,
        neighbourhood: picked.osm.parts.neighbourhood ?? hit.parts.neighbourhood,
        suburb: picked.osm.parts.suburb ?? picked.osm.parts.neighbourhood ?? hit.parts.suburb,
        city: hit.parts.city || picked.osm.parts.city || picked.osm.parts.town || picked.osm.parts.village,
        county: hit.parts.county || picked.osm.parts.county,
        state: hit.parts.state || picked.osm.parts.state,
      },
    };
  });
}

/** Marca los tramos de OSM con el rango de SU localidad, para no ofrecer Chiclana 9000 ahí. */
export function tagStreetHeightRanges(hits: GeocodeHit[], ranges: LocalityStreetRange[]): GeocodeHit[] {
  if (!ranges.length) return hits;
  return hits.map((hit) => {
    if (hit.positionQuality === 'interpolated' || hit.positionQuality === 'anchored') return hit;
    const city = hit.parts.city || hit.parts.town || hit.parts.village || '';
    const match = ranges.find(
      (range) =>
        sameCityName(city, range.locality) && roadMatchScore(hitStreetName(hit), range.streetName) >= 1,
    );
    if (!match) return hit;
    return {
      ...hit,
      heightRange: match.range,
      streetId: hit.streetId ?? match.streetId,
    };
  });
}
