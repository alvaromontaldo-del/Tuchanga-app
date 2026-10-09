import {
  fallbackStreetNames,
  houseNumberDigits,
  isHouseNumberAboveStreetEnd,
  parseStreetAddressQuery,
  roadMatchScore,
  type GeocodeHit,
  type LocalityStreetRange,
  type StreetHeightRange,
} from '../utils/streetAddressQuery';

const GEOREF_BASE = 'https://apis.datos.gob.ar/georef/api';
const GEOREF_TIMEOUT_MS = 2_500;
const UBICACION_TTL_MS = 10 * 60 * 1000;
/** No anclamos Chiclana 148 al 200 si el padrón más cercano está a más de esto. */
const MAX_ANCHOR_DELTA = 200;

export type GeorefLookup = {
  hits: GeocodeHit[];
  /** La altura se pasa del final de las calles homónimas en la zona. */
  aboveStreetEnd: boolean;
  localityRanges: LocalityStreetRange[];
};

type Ubicacion = {
  provincia: string;
  provinciaId: string;
  departamento: string;
};

type GeorefScope = {
  provincia: string;
  departamento?: string;
};

type AlturaLado = { derecha?: number; izquierda?: number };

type GeorefDireccion = {
  nomenclatura?: string;
  altura?: { valor?: number | string };
  calle?: { id?: string; nombre?: string; categoria?: string | null };
  localidad_censal?: { nombre?: string };
  departamento?: { nombre?: string };
  provincia?: { nombre?: string };
  ubicacion?: { lat?: number; lon?: number };
};

type GeorefCalle = {
  id?: string;
  nombre?: string;
  categoria?: string | null;
  altura?: { inicio?: AlturaLado; fin?: AlturaLado };
  localidad_censal?: { nombre?: string };
  departamento?: { nombre?: string };
};

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'al']);

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** «AV SANTA FE» → «Avenida Santa Fe». La localidad ya viene con mayúsculas del padrón. */
export function prettyGeorefStreet(nombre: string, categoria?: string | null): string {
  const raw = nombre.trim().replace(/\s+/g, ' ');
  const lead = raw.match(/^(av|avda|bv|bvd|pje|diag)\.?(?=\s)/i)?.[1]?.toLowerCase() ?? '';
  const withoutKind = lead ? raw.replace(/^(av|avda|bv|bvd|pje|diag)\.?\s+/i, '') : raw;
  const titled = withoutKind
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
  const cat = (categoria ?? '').toUpperCase();
  if (cat === 'AV' || lead === 'av' || lead === 'avda') return `Avenida ${titled}`.trim();
  if (cat === 'BV' || lead === 'bv' || lead === 'bvd') return `Boulevard ${titled}`.trim();
  if (lead === 'pje') return `Pasaje ${titled}`.trim();
  return titled;
}

function rangeFromAltura(altura: GeorefCalle['altura']): StreetHeightRange | null {
  const inicios = [altura?.inicio?.derecha, altura?.inicio?.izquierda].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  const fines = [altura?.fin?.derecha, altura?.fin?.izquierda].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (!fines.length) return null;
  return {
    min: inicios.length ? Math.min(...inicios) : 0,
    max: Math.max(...fines),
  };
}

export function parseUbicacion(payload: unknown): Ubicacion | null {
  const ubicacion = (payload as { ubicacion?: Record<string, unknown> } | null)?.ubicacion;
  if (!ubicacion) return null;
  const provincia = ubicacion.provincia as { id?: string; nombre?: string } | undefined;
  const departamento = ubicacion.departamento as { id?: string; nombre?: string } | undefined;
  if (!provincia?.nombre || !provincia.id || !departamento?.nombre) return null;
  return {
    provincia: provincia.nombre,
    provinciaId: String(provincia.id),
    departamento: departamento.nombre,
  };
}

export function scopeFromUbicacion(ubicacion: Ubicacion): GeorefScope {
  const caba =
    ubicacion.provinciaId === '02' || norm(ubicacion.provincia).includes('ciudad autonoma');
  // En CABA el departamento es la comuna: Santa Fe 2500 está en Comuna 2 y el usuario en Palermo (14).
  if (caba) return { provincia: ubicacion.provincia };
  return { provincia: ubicacion.provincia, departamento: ubicacion.departamento };
}

function streetNamesToTry(street: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of [street, ...fallbackStreetNames(street)]) {
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Alturas vecinas para un hueco del padrón (Chiclana 148 no está, 200 sí). */
export function probeHeightsNear(houseNumber: number, ranges: StreetHeightRange[]): number[] {
  const candidates = new Set<number>();
  for (const step of [50, 100, 200]) {
    const base = Math.round(houseNumber / step) * step;
    for (const delta of [-step, 0, step]) {
      const height = base + delta;
      if (height < 1 || height === houseNumber) continue;
      if (Math.abs(height - houseNumber) > MAX_ANCHOR_DELTA) continue;
      if (ranges.some((range) => height >= range.min && height <= range.max)) candidates.add(height);
    }
  }
  return [...candidates]
    .sort((a, b) => Math.abs(a - houseNumber) - Math.abs(b - houseNumber) || a - b)
    .slice(0, 6);
}

function direccionToHit(
  row: GeorefDireccion,
  quality: 'interpolated' | 'anchored',
  provincia?: string,
): GeocodeHit | null {
  const lat = row.ubicacion?.lat;
  const lng = row.ubicacion?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const streetId = row.calle?.id?.trim() ?? '';
  const road = prettyGeorefStreet(row.calle?.nombre ?? '', row.calle?.categoria);
  if (!road) return null;
  const partido = row.departamento?.nombre?.trim() || '';
  const state = row.provincia?.nombre?.trim() || provincia?.trim() || '';
  const locality = row.localidad_censal?.nombre?.trim() || partido;
  return {
    id: `georef-${streetId || 'calle'}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
    lat,
    lng,
    displayName:
      row.nomenclatura?.trim() ||
      [road, locality, partido, state].filter(Boolean).join(', '),
    parts: {
      road,
      city: locality || undefined,
      county: partido || undefined,
      state: state || undefined,
    },
    osmClass: 'place',
    positionQuality: quality,
    streetId: streetId || undefined,
  };
}

export function parseDirecciones(
  payload: unknown,
  street: string,
  quality: 'interpolated' | 'anchored',
  provincia?: string,
): GeocodeHit[] {
  const rows = (payload as { direcciones?: GeorefDireccion[] } | null)?.direcciones ?? [];
  const hits: GeocodeHit[] = [];
  for (const row of rows) {
    const nombre = row.calle?.nombre ?? '';
    if (roadMatchScore(nombre, street) < 1) continue;
    const hit = direccionToHit(row, quality, provincia);
    if (hit) hits.push(hit);
  }
  return hits;
}

export function parseCalles(payload: unknown, street: string): LocalityStreetRange[] {
  const rows = (payload as { calles?: GeorefCalle[] } | null)?.calles ?? [];
  const ranges: LocalityStreetRange[] = [];
  for (const row of rows) {
    const nombre = row.nombre ?? '';
    if (roadMatchScore(nombre, street) < 1) continue;
    const range = rangeFromAltura(row.altura);
    const locality = row.localidad_censal?.nombre?.trim() || '';
    if (!range || !locality) continue;
    ranges.push({
      locality,
      streetName: prettyGeorefStreet(nombre, row.categoria),
      streetId: row.id?.trim() || nombre,
      range,
    });
  }
  return mergeLocalityRanges(ranges);
}

function mergeLocalityRanges(ranges: LocalityStreetRange[]): LocalityStreetRange[] {
  const byKey = new Map<string, LocalityStreetRange>();
  for (const row of ranges) {
    const key = `${norm(row.locality)}|${norm(row.streetName)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...row, range: { ...row.range } });
      continue;
    }
    prev.range = {
      min: Math.min(prev.range.min, row.range.min),
      max: Math.max(prev.range.max, row.range.max),
    };
  }
  return [...byKey.values()];
}

function insideSpan(houseNumber: number, ranges: StreetHeightRange[]): boolean {
  if (!ranges.length) return false;
  const min = Math.min(...ranges.map((range) => range.min));
  const max = Math.max(...ranges.map((range) => range.max));
  return houseNumber >= min && houseNumber <= max;
}

async function georefFetch(url: string, init?: RequestInit): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOREF_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'YaChanga/1.0',
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let ubicacionCache: { key: string; at: number; value: Ubicacion } | null = null;

export function resetGeorefCacheForTests(): void {
  ubicacionCache = null;
}

async function fetchUbicacion(near: { lat: number; lng: number }): Promise<Ubicacion | null> {
  const key = `${near.lat.toFixed(2)},${near.lng.toFixed(2)}`;
  const now = Date.now();
  if (ubicacionCache && ubicacionCache.key === key && now - ubicacionCache.at < UBICACION_TTL_MS) {
    return ubicacionCache.value;
  }
  const params = new URLSearchParams();
  params.set('lat', String(near.lat));
  params.set('lon', String(near.lng));
  const payload = await georefFetch(`${GEOREF_BASE}/ubicacion?${params.toString()}`);
  if (!payload) return null;
  const ubicacion = parseUbicacion(payload);
  if (!ubicacion) return null;
  ubicacionCache = { key, at: now, value: ubicacion };
  return ubicacion;
}

function direccionParams(street: string, digits: string, scope: GeorefScope, max: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set('direccion', `${street} ${digits}`);
  params.set('provincia', scope.provincia);
  if (scope.departamento) params.set('departamento', scope.departamento);
  params.set('max', String(max));
  return params;
}

async function searchDirecciones(
  street: string,
  digits: string,
  scope: GeorefScope,
): Promise<GeocodeHit[] | null> {
  const payload = await georefFetch(
    `${GEOREF_BASE}/direcciones?${direccionParams(street, digits, scope, 10).toString()}`,
  );
  if (!payload) return null;
  return parseDirecciones(payload, street, 'interpolated', scope.provincia);
}

async function searchCalles(street: string, scope: GeorefScope): Promise<LocalityStreetRange[] | null> {
  const params = new URLSearchParams();
  params.set('nombre', street);
  params.set('provincia', scope.provincia);
  if (scope.departamento) params.set('departamento', scope.departamento);
  params.set('max', '30');
  const payload = await georefFetch(`${GEOREF_BASE}/calles?${params.toString()}`);
  if (!payload) return null;
  return parseCalles(payload, street);
}

async function searchAnchor(
  street: string,
  houseNumber: number,
  scope: GeorefScope,
  ranges: StreetHeightRange[],
): Promise<GeocodeHit[]> {
  const heights = probeHeightsNear(houseNumber, ranges);
  if (!heights.length) return [];
  const body = {
    direcciones: heights.map((height) => ({
      direccion: `${street} ${height}`,
      provincia: scope.provincia,
      ...(scope.departamento ? { departamento: scope.departamento } : {}),
      max: 5,
    })),
  };
  const payload = await georefFetch(`${GEOREF_BASE}/direcciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!payload) return [];
  const blocks = (payload as { resultados?: Array<Record<string, unknown>> }).resultados ?? [];
  let best: { delta: number; hits: GeocodeHit[] } | null = null;
  for (const block of blocks) {
    const altura = (block.parametros as { direccion?: { altura?: { valor?: number | string } } } | undefined)
      ?.direccion?.altura?.valor;
    const probed = Number(altura);
    if (!Number.isFinite(probed)) continue;
    const delta = Math.abs(probed - houseNumber);
    if (delta > MAX_ANCHOR_DELTA) continue;
    const hits = parseDirecciones(block, street, 'anchored', scope.provincia);
    if (!hits.length) continue;
    if (!best || delta < best.delta) best = { delta, hits };
  }
  return best?.hits ?? [];
}

/**
 * Direcciones interpoladas del padrón (INDEC) en la zona del usuario.
 * null si la API no responde: el llamador sigue con Nominatim.
 */
export async function fetchGeorefAddressHits(
  query: string,
  near: { lat: number; lng: number },
): Promise<GeorefLookup | null> {
  const parsed = parseStreetAddressQuery(query);
  const digits = parsed ? houseNumberDigits(parsed.houseNumber) : '';
  if (!parsed || !digits) return null;
  const houseNumber = Number(digits);
  if (!Number.isFinite(houseNumber)) return null;

  const ubicacion = await fetchUbicacion(near);
  if (!ubicacion) return null;
  const scope = scopeFromUbicacion(ubicacion);
  const names = streetNamesToTry(parsed.street);

  let interpolated: GeocodeHit[] = [];
  let direccionName = names[0] ?? parsed.street;
  for (const name of names) {
    const found = await searchDirecciones(name, digits, scope);
    if (!found) return null;
    if (found.length) {
      interpolated = found;
      direccionName = name;
      break;
    }
  }
  if (interpolated.length) {
    return { hits: interpolated, aboveStreetEnd: false, localityRanges: [] };
  }

  let localityRanges: LocalityStreetRange[] = [];
  let callesOk = false;
  for (const name of names) {
    const found = await searchCalles(name, scope);
    if (!found) continue;
    callesOk = true;
    if (found.length) {
      localityRanges = found;
      direccionName = name;
      break;
    }
  }
  if (!callesOk) {
    return { hits: [], aboveStreetEnd: false, localityRanges: [] };
  }

  const ranges = localityRanges.map((row) => row.range);
  if (isHouseNumberAboveStreetEnd(digits, ranges)) {
    return { hits: [], aboveStreetEnd: true, localityRanges };
  }
  if (!insideSpan(houseNumber, ranges)) {
    return { hits: [], aboveStreetEnd: false, localityRanges };
  }

  const anchored = await searchAnchor(direccionName, houseNumber, scope, ranges);
  return { hits: anchored, aboveStreetEnd: false, localityRanges };
}
