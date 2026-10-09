/**
 * Completa profiles.direccion_lat, direccion_lng y direccion_completa
 * en filas viejas que todavía no tienen esas columnas cargadas.
 *
 * NO correrlo junto con el deploy. Primero aplicar
 * supabase/20261009_card_206_direccion_exacta.sql.
 *
 * Geocodificación: Nominatim (OpenStreetMap), el mismo servicio que ya usa
 * la app. No pide una clave nueva. Hay que identificar la app (User-Agent
 * YaChanga/1.0) y esperar al menos 1 segundo entre pedidos.
 * No uses una clave de Google Geocoding: este script no la tiene y no hay
 * que agregarla para correrlo.
 *
 * Base: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, las claves que ya tiene
 * el proyecto. No las inventa. Si faltan, sale sin escribir.
 *
 * Si Nominatim no responde, copia lat/lng desde profiles.location cuando
 * el punto existe y deja direccion_completa vacía. Al abrir Maps, si no hay
 * coordenadas, la app busca la dirección completa (o la calle corta) más
 * ", Argentina".
 *
 * Uso (desde la raíz del repo, cuando se decida correrlo):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/backfill_direccion_exacta.mjs
 */

import { createClient } from '@supabase/supabase-js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'YaChanga/1.0 (backfill direccion exacta)';
const PAUSE_MS = 1100;

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error(
    'Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (claves que ya tiene el proyecto). No se escribió nada.',
  );
  console.error(
    'Geocodificador: Nominatim (OpenStreetMap), sin clave nueva. No hace falta una API key de Google.',
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pointFromLocation(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && raw.type === 'Point' && Array.isArray(raw.coordinates)) {
    const [lng, lat] = raw.coordinates;
    return finitePoint(lat, lng);
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      return pointFromLocation(JSON.parse(text));
    } catch {
      return null;
    }
  }
  const wkt = text.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (wkt) return finitePoint(Number(wkt[2]), Number(wkt[1]));
  if (/^[0-9a-fA-F]+$/.test(text) && text.length >= 50) {
    const bytes = new Uint8Array(text.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
    }
    const view = new DataView(bytes.buffer);
    const little = view.getUint8(0) === 1;
    const lng = view.getFloat64(9, little);
    const lat = view.getFloat64(17, little);
    return finitePoint(lat, lng);
  }
  return null;
}

function finitePoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function piece(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function completeFromNominatim(data) {
  const address = data?.address ?? {};
  const road = piece(address.road) || piece(address.pedestrian);
  const number = piece(address.house_number);
  const street = road ? (number ? `${road} ${number}` : road) : '';
  const barrio = piece(address.neighbourhood) || piece(address.suburb);
  const localidad =
    piece(address.city) || piece(address.town) || piece(address.village) || piece(address.municipality);
  const county = piece(address.county);
  const state = piece(address.state);
  const partido =
    !county || /^partido de /i.test(county) || /^comuna/i.test(county)
      ? county
      : /ciudad autonoma|^caba$/i.test(state)
        ? county
        : `Partido de ${county}`;
  const parts = [street, barrio, localidad, partido, state].filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const part of parts) {
    const key = part.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }
  if (unique.length) return unique.join(', ');
  return piece(data?.display_name).replace(/,?\s*Argentina\s*$/i, '');
}

async function reverseNominatim(lat, lng) {
  const params = new URLSearchParams({
    format: 'json',
    lat: String(lat),
    lon: String(lng),
    addressdetails: '1',
    zoom: '18',
    'accept-language': 'es',
  });
  const response = await fetch(`${NOMINATIM}?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Nominatim respondió ${response.status}`);
  }
  return completeFromNominatim(await response.json());
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('profiles')
  .select('id, location, direccion_lat, direccion_lng, direccion_completa');

if (error) {
  console.error(
    'No se pudieron leer los perfiles. Aplicá antes supabase/20261009_card_206_direccion_exacta.sql.',
  );
  console.error(error.message);
  process.exit(1);
}

const pending = (data ?? []).filter(
  (row) => row.direccion_lat == null || row.direccion_lng == null || !piece(row.direccion_completa),
);

console.log(`Filas a completar: ${pending.length}. Geocodificador: Nominatim, sin clave nueva.`);

let updated = 0;
let skipped = 0;

for (const row of pending) {
  const stored = finitePoint(Number(row.direccion_lat), Number(row.direccion_lng));
  const fromLocation = pointFromLocation(row.location);
  const point = stored ?? fromLocation;
  let completa = piece(row.direccion_completa);

  if (!point) {
    skipped += 1;
    console.warn(
      `${row.id}: sin coordenadas en direccion_lat/lng ni en location. Maps va a usar la dirección completa con ", Argentina".`,
    );
    continue;
  }

  if (!completa) {
    try {
      completa = await reverseNominatim(point.lat, point.lng);
    } catch (err) {
      console.warn(
        `${row.id}: Nominatim no completó la dirección (${err instanceof Error ? err.message : err}). Quedan las coordenadas.`,
      );
    }
    await sleep(PAUSE_MS);
  }

  const patch = {};
  if (row.direccion_lat == null) patch.direccion_lat = point.lat;
  if (row.direccion_lng == null) patch.direccion_lng = point.lng;
  if (!piece(row.direccion_completa) && completa) patch.direccion_completa = completa;
  if (!Object.keys(patch).length) continue;

  const write = await supabase.from('profiles').update(patch).eq('id', row.id);
  if (write.error) {
    console.error(`${row.id}: ${write.error.message}`);
    process.exitCode = 1;
    continue;
  }
  updated += 1;
}

console.log(`Actualizadas: ${updated}. Sin coordenadas (fallback de Maps): ${skipped}.`);
