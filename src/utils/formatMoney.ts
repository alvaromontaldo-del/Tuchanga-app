/**
 * Redondeo hacia arriba a enteros no negativos (ARS).
 * Usar en UI para precio final y costo de servicio YaChanga.
 */
export function ceilMoneyArs(amount: number | string): number {
  return Math.max(0, Math.ceil(Number(amount) || 0));
}

const moneyCeilFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formatea un monto ARS como entero positivo con Math.ceil (sin decimales). */
export function formatMoneyCeilAr(amount: number | string): string {
  return `$${moneyCeilFormatter.format(ceilMoneyArs(amount))}`;
}
