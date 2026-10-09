import { mapsQueryWithArgentina } from './formatAddress';

export type ClientMapsTarget = {
  lat?: number | null;
  lng?: number | null;
  /** Calle corta que ve el profesional. Etiqueta del pin. */
  direccionTexto?: string | null;
  /** Localidad, partido y provincia. Fallback si no hay coordenadas. */
  direccionCompleta?: string | null;
};

export type ClientMapsUrls = {
  web: string;
  android: string;
  ios: string;
  /** Google Maps en iOS. Se abre con try/catch: el esquema no está en la config. */
  iosGoogle: string | null;
};

function coordQuery(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

function hasPin(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

function pinLabel(target: ClientMapsTarget): string {
  return target.direccionTexto?.trim() || target.direccionCompleta?.trim() || '';
}

function fallbackQuery(target: ClientMapsTarget): string {
  return mapsQueryWithArgentina(target.direccionCompleta?.trim() || target.direccionTexto?.trim() || '');
}

/**
 * Con coordenadas, clava el pin en ese punto y usa el texto solo como etiqueta.
 * Buscar «Volta 1140, Parque Sarmiento» sin partido manda a Parque Sarmiento de CABA.
 * Sin coordenadas, busca la dirección completa + «, Argentina».
 */
export function clientMapsUrls(target: ClientMapsTarget): ClientMapsUrls {
  const label = pinLabel(target);
  if (hasPin(target.lat, target.lng)) {
    const point = coordQuery(target.lat as number, target.lng as number);
    if (!label) {
      return {
        web: `https://www.google.com/maps/search/?api=1&query=${point}`,
        android: `geo:${point}?q=${point}`,
        ios: `maps://?daddr=${point}`,
        iosGoogle: null,
      };
    }
    const pin = `${point}(${encodeURIComponent(label)})`;
    return {
      web: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point}(${label})`)}`,
      android: `geo:0,0?q=${pin}`,
      ios: `maps://?ll=${point}&q=${encodeURIComponent(label)}`,
      iosGoogle: `comgooglemaps://?q=${pin}&center=${point}`,
    };
  }

  const text = fallbackQuery(target);
  if (!text) {
    return {
      web: 'https://www.google.com/maps/search/?api=1&query=',
      android: 'geo:0,0?q=',
      ios: 'maps://?q=',
      iosGoogle: 'comgooglemaps://?q=',
    };
  }
  const query = encodeURIComponent(text);
  return {
    web: `https://www.google.com/maps/search/?api=1&query=${query}`,
    android: `geo:0,0?q=${query}`,
    ios: `maps://?q=${query}`,
    iosGoogle: `comgooglemaps://?q=${query}`,
  };
}
