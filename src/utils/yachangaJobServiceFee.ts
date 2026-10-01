/**
 * Costo de servicio YaChanga al contratar un profesional.
 * Espejo de display de `public.calc_yachanga_service_fee`.
 * El valor que se cobra lo calcula el servidor al cotizar y queda guardado
 * en `contrataciones.comision_app`. Esta función no es la fuente de cobro.
 *
 * No aplica a materiales (`calculateServiceFee` / `calculate_material_service_fee`).
 */

export const YACHANGA_JOB_SERVICE_FEE = {
  floorArs: 5_000,
  capArs: 23_000,
  /** El marginal se lleva al peso entero hacia arriba, igual que el CEIL histórico. */
  ceilToPeso: true,
  /** Tasa = rateNumerator / rateDenominator (1000/10000 = 10%). */
  rateDenominator: 10_000,
  tiers: [
    { upToArs: 50_000, rateNumerator: 1_000 },
    { upToArs: 200_000, rateNumerator: 600 },
    { upToArs: 500_000, rateNumerator: 300 },
  ],
} as const;

/**
 * Fee marginal por tramos sobre el monto cotizado por el profesional.
 * Piso $5.000 (también si el monto es 0). Tope $23.000, fijo por encima del último tramo.
 */
export function calculateYachangaServiceFee(serviceAmount: number): number {
  if (typeof serviceAmount !== 'number' || !Number.isFinite(serviceAmount)) {
    throw new Error('El monto del trabajo tiene que ser numérico');
  }
  if (serviceAmount < 0) {
    throw new Error('El monto del trabajo no puede ser negativo');
  }

  const cfg = YACHANGA_JOB_SERVICE_FEE;
  const tiers = cfg.tiers;
  const last = tiers[tiers.length - 1];
  if (!last) return cfg.floorArs;

  if (serviceAmount > last.upToArs) {
    return cfg.capArs;
  }

  let cursor = 0;
  let scaled = 0;
  for (const tier of tiers) {
    if (serviceAmount <= cursor) break;
    const portion = Math.min(serviceAmount, tier.upToArs) - cursor;
    if (portion > 0) {
      scaled += Math.round(portion * tier.rateNumerator);
    }
    cursor = tier.upToArs;
  }

  const raw = scaled / cfg.rateDenominator;
  const fee = cfg.ceilToPeso ? Math.ceil(raw) : raw;
  if (fee < cfg.floorArs) return cfg.floorArs;
  if (fee > cfg.capArs) return cfg.capArs;
  return fee;
}
