const ROUNDED_KM = /^\d+(,\d)?$/;

/**
 * Arma la frase del encabezado. El servidor ya redondeó y no manda coordenadas:
 * «menos de 1 km» o un token como «3,5» / «12». Cualquier otro texto se descarta.
 */
export function approxDistanceCaption(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  if (value === 'menos de 1 km') return 'menos de 1 km';
  if (!ROUNDED_KM.test(value)) return null;
  return `a ${value} km aprox.`;
}

/**
 * El subtítulo genérico «Cliente» cede el lugar a la distancia.
 * Un reclamo u otro subtítulo se mantiene.
 */
export function showChatHeaderSubtitle(
  subtitle: string | null | undefined,
  distanceCaption: string | null,
): boolean {
  const text = (subtitle ?? '').trim();
  if (!text) return false;
  if (distanceCaption && text === 'Cliente') return false;
  return true;
}
