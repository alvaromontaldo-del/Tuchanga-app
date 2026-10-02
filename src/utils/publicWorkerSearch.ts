/** Grilla de ~1 km (2 decimales). Sirve para un pin, no para el domicilio. */
export function coarseCoord(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 100) / 100;
}
