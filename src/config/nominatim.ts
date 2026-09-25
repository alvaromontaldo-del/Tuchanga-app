import {
  buildShortAddressFromParts,
  formatShortAddress,
  type NominatimAddressParts,
} from '../utils/formatAddress';
import {
  fallbackStreetNames,
  hitsIncludeNearbyStreet,
  houseNumberDigits,
  parseStreetAddressQuery,
  rankGeocodeHits,
  stampSuggestions,
  type GeocodeHit,
} from '../utils/streetAddressQuery';

export type NominatimSuggestion = {
  id: string;
  address: string;
  /** Calle OSM sin la altura tipeada. La UI vuelve a armar el rótulo con el texto del campo. */
  plainAddress: string;
  lat: number;
  lng: number;
};

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export type NominatimSearchOptions = {
  /** ISO 3166-1 alpha2, ej: 'ar' */
  countryCode?: string;
  /**
   * Sesgo por cercanía (bounding box).
   * Sin altura, bounded=1 limita a ~20 km.
   * Con altura, la caja solo ordena: no esconde portales que caen más lejos.
   */
  near?: { lat: number; lng: number };
};

function buildViewBoxAround(lat: number, lng: number, deltaDeg: number) {
  // Nominatim: viewbox=left,top,right,bottom (lon,lat)
  const left = lng - deltaDeg;
  const right = lng + deltaDeg;
  const top = lat + deltaDeg;
  const bottom = lat - deltaDeg;
  return `${left},${top},${right},${bottom}`;
}


type NominatimRaw = {
  place_id?: number | string;
  display_name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  address?: NominatimAddressParts;
};

function searchParamsFor(
  query: string,
  opts: NominatimSearchOptions | undefined,
  biasNear: boolean,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('format', 'json');
  params.set('addressdetails', '1');
  params.set('accept-language', 'es');
  params.set('countrycodes', (opts?.countryCode ?? 'ar').toLowerCase());

  const parsed = parseStreetAddressQuery(query);
  const digits = parsed ? houseNumberDigits(parsed.houseNumber) : '';
  if (parsed && digits) {
    // Nominatim interpola mejor con calle y altura juntas (`street=1140 Volta`)
    // que con `q=Volta 1140`, que a veces devuelve solo la calle o un comercio homónimo.
    params.set('street', `${digits} ${parsed.street}`);
    params.set('limit', '8');
  } else {
    params.set('q', query);
    params.set('limit', '6');
  }

  if (opts?.near && biasNear) {
    // ~20km. Con altura no recortamos (bounded=0): si no, se pierde el portal
    // cuando el único punto numerado cae fuera de la caja del GPS.
    params.set('viewbox', buildViewBoxAround(opts.near.lat, opts.near.lng, 0.18));
    params.set('bounded', parsed && digits ? '0' : '1');
  }

  return params;
}

async function fetchGeocodeHits(params: URLSearchParams): Promise<GeocodeHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'YaChanga/1.0',
      },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let data: NominatimRaw[] = [];
  try {
    data = (await res.json()) as NominatimRaw[];
  } catch {
    return [];
  }

  return (data ?? [])
    .map((item) => {
      const lat = numOrNull(item.lat);
      const lng = numOrNull(item.lon);
      if (!item.display_name || lat === null || lng === null) return null;
      return {
        id: String(item.place_id ?? `${lat},${lng}`),
        lat,
        lng,
        displayName: item.display_name,
        parts: { ...(item.address ?? {}) },
        osmClass: item.class,
      } satisfies GeocodeHit;
    })
    .filter((item): item is GeocodeHit => Boolean(item));
}

function mergeHits(primary: GeocodeHit[], extra: GeocodeHit[]): GeocodeHit[] {
  const seen = new Set(primary.map((hit) => hit.id));
  const merged = [...primary];
  for (const hit of extra) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
  }
  return merged;
}

export async function fetchNominatimSuggestions(
  query: string,
  opts?: NominatimSearchOptions,
): Promise<NominatimSuggestion[]> {
  const q = query.trim();
  if (q.length < 4) return [];

  const parsed = parseStreetAddressQuery(q);
  let hits = await fetchGeocodeHits(searchParamsFor(q, opts, true));

  // `street=1140 Alejandro Volta` puede devolver solo un homónimo a 20 km
  // (Tigre) y ni enterarse de «Volta» en Palermo. Si no hay esa calle al lado,
  // buscamos el nombre y, si hace falta, el último token. La altura tipeada
  // se conserva igual en la etiqueta.
  const digits = parsed ? houseNumberDigits(parsed.houseNumber) : '';
  // 8 km: un homónimo en otro partido (Tigre) no cuenta como “la calle de acá”.
  const localStreetM = 8_000;
  if (parsed && digits && opts?.near && !hitsIncludeNearbyStreet(hits, parsed, opts.near, localStreetM)) {
    const names = [parsed.street, ...fallbackStreetNames(parsed.street)];
    for (const name of names) {
      const local = new URLSearchParams();
      local.set('q', name);
      local.set('format', 'json');
      local.set('addressdetails', '1');
      local.set('accept-language', 'es');
      local.set('countrycodes', (opts.countryCode ?? 'ar').toLowerCase());
      local.set('limit', '6');
      local.set('viewbox', buildViewBoxAround(opts.near.lat, opts.near.lng, 0.18));
      local.set('bounded', '1');
      const localHits = await fetchGeocodeHits(local);
      hits = mergeHits(hits, localHits);
      if (hitsIncludeNearbyStreet(hits, parsed, opts.near, localStreetM)) break;
    }
  }

  return stampSuggestions(
    q,
    rankGeocodeHits(hits, q, opts?.near).map((item) => ({
      id: item.id,
      address: item.address,
      plainAddress: item.plainAddress?.trim() || item.address,
      lat: item.lat,
      lng: item.lng,
    })),
  );
}

export async function reverseNominatim(lat: number, lng: number): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?` +
    `lat=${encodeURIComponent(String(lat))}` +
    `lon=${encodeURIComponent(String(lng))}` +
    `&format=json&zoom=18&addressdetails=1&accept-language=es`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'YaChanga/1.0',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: NominatimAddressParts;
      display_name?: string;
    };
    const short =
      buildShortAddressFromParts(data.address ?? {}) ||
      (data.display_name?.trim() ? formatShortAddress(data.display_name.trim()) : null);
    return short;
  } catch {
    return null;
  }
}

export async function reverseNominatimStreet(lat: number, lng: number): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?` +
    `format=json&lat=${encodeURIComponent(String(lat))}` +
    `&lon=${encodeURIComponent(String(lng))}` +
    `&addressdetails=1&zoom=18&accept-language=es`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'YaChanga/1.0',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: {
        road?: string;
        house_number?: string;
        pedestrian?: string;
        neighbourhood?: string;
        suburb?: string;
        city?: string;
        town?: string;
        village?: string;
        state?: string;
      };
      display_name?: string;
    };

    const a = data.address;
    const short = buildShortAddressFromParts(a ?? {});
    if (short) return short;
    return data.display_name?.trim() ? formatShortAddress(data.display_name.trim()) : null;
  } catch {
    return null;
  }
}

export function osmTileUrlTemplate() {
  // Tile estándar de OpenStreetMap (sin API key).
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}

