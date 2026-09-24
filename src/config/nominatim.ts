import {
  buildShortAddressFromParts,
  formatShortAddress,
  type NominatimAddressParts,
} from '../utils/formatAddress';

export type NominatimSuggestion = {
  id: string;
  address: string;
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
   * Cuando está, usamos bounded=1 para priorizar y limitar resultados.
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


/** Si el usuario escribio "Volta 1140" y Nominatim no trae house_number, recuperar la altura del query. */
function extractStreetNumberFromQuery(query: string): string | null {
  const m = query.trim().match(/^(.*?)\s+(\d{1,6}[A-Za-z]?)\s*$/);
  if (!m) return null;
  const street = m[1].trim();
  const num = m[2].trim();
  if (street.length < 2) return null;
  return num;
}

function ensureHouseNumberInAddress(address: string, query: string): string {
  const num = extractStreetNumberFromQuery(query);
  if (!num) return address;
  const escaped = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escaped}\\b`).test(address)) return address;
  const parts = address.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return address;
  if (new RegExp(`\\b${escaped}\\b`).test(parts[0])) return address;
  parts[0] = `${parts[0]} ${num}`;
  return parts.join(', ');
}

export async function fetchNominatimSuggestions(
  query: string,
  opts?: NominatimSearchOptions,
): Promise<NominatimSuggestion[]> {
  const q = query.trim();
  if (q.length < 4) return [];

  const params = new URLSearchParams();
  params.set('q', q);
  params.set('format', 'json');
  params.set('addressdetails', '1');
  params.set('limit', '6');
  params.set('accept-language', 'es');
  // Muy importante: evita resultados de otros países.
  params.set('countrycodes', (opts?.countryCode ?? 'ar').toLowerCase());

  if (opts?.near) {
    // ~20km alrededor (0.18°) aprox; suficiente para “Garibaldi” sin irse a otros países.
    params.set('viewbox', buildViewBoxAround(opts.near.lat, opts.near.lng, 0.18));
    params.set('bounded', '1');
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        // Nominatim recomienda identificar la app; en mobile el header puede ignorarse,
        // pero no rompe y ayuda cuando está disponible.
        'User-Agent': 'YaChanga/1.0',
      },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let data: Array<{
    place_id?: number | string;
    display_name?: string;
    lat?: string;
    lon?: string;
    address?: NominatimAddressParts;
  }> = [];
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return [];
  }

  return (data ?? [])
    .map((x) => {
      const lat = numOrNull(x.lat);
      const lng = numOrNull(x.lon);
      if (!x.display_name || lat === null || lng === null) return null;
      const parts: NominatimAddressParts = { ...(x.address ?? {}) };
      if (!parts.house_number) {
        const fromQuery = extractStreetNumberFromQuery(q);
        if (fromQuery) parts.house_number = fromQuery;
      }
      const short =
        buildShortAddressFromParts(parts) || formatShortAddress(x.display_name);
      const shortWithNum = ensureHouseNumberInAddress(short, q);
      return {
        id: String(x.place_id ?? `${lat},${lng}`),
        address: shortWithNum,
        lat,
        lng,
      } satisfies NominatimSuggestion;
    })
    .filter((x): x is NominatimSuggestion => Boolean(x));
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

