export type ClientMapsTarget = {
  lat: number;
  lng: number;
  direccionTexto?: string | null;
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

/**
 * Busca la dirección escrita. Las coordenadas solas hacen que Google
 * enganche el punto al comercio más cercano (Volta 1140 abría «Ojo Indio»,
 * Volta 1121). El texto «Alejandro Volta 1140, Parque Sarmiento» cae en
 * esa calle. Si no hay localidad, el pin queda en las coordenadas con el
 * texto de etiqueta para no resolver la calle en otra ciudad.
 */
export function clientMapsUrls(target: ClientMapsTarget): ClientMapsUrls {
  const { lat, lng } = target;
  const text = target.direccionTexto?.trim() ?? '';
  const point = coordQuery(lat, lng);

  if (!text) {
    return {
      web: `https://www.google.com/maps/search/?api=1&query=${point}`,
      android: `geo:${point}?q=${point}`,
      ios: `maps://?daddr=${point}`,
      iosGoogle: null,
    };
  }

  if (!text.includes(',')) {
    const pin = `${point}(${encodeURIComponent(text)})`;
    return {
      web: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point}(${text})`)}`,
      android: `geo:0,0?q=${pin}`,
      ios: `maps://?q=${encodeURIComponent(text)}&sll=${point}`,
      iosGoogle: `comgooglemaps://?q=${encodeURIComponent(text)}&center=${point}`,
    };
  }

  const query = encodeURIComponent(text);
  return {
    web: `https://www.google.com/maps/search/?api=1&query=${query}`,
    android: `geo:${point}?q=${query}`,
    ios: `maps://?q=${query}&sll=${point}`,
    iosGoogle: `comgooglemaps://?q=${query}&center=${point}`,
  };
}
