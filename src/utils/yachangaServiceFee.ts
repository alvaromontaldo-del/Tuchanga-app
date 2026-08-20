/** Fee de servicio YaChanga sobre presupuestos de materiales (ARS). */

export const YACHANGA_SERVICE_FEE_CAP_ARS = 23_000;
export const YACHANGA_SERVICE_FEE_MIN_ARS = 5_000;
export const YACHANGA_TIER1_LIMIT_ARS = 200_000;
/** Umbral donde el tramo 8%+6% alcanza el tope ($23.000). */
export const YACHANGA_TIER2_CAP_BREAKPOINT_ARS = 316_667;
export const YACHANGA_TIER1_RATE = 0.08;
export const YACHANGA_TIER2_RATE = 0.06;

export type ServiceFeeTierBreakdown = {
  tier1: number;
  tier2: number;
};

export type ServiceFeeResult = {
  /** Monto final a cobrar (ceil + mínimo + tope). */
  serviceFee: number;
  /** Porcentaje efectivo sobre el total ((serviceFee / totalAmount) * 100). */
  effectiveRate: number;
  /** true si se aplicó el tope de $23.000. */
  isCapped: boolean;
  /** true si el tramo calculado quedó por debajo del mínimo ($5.000). */
  isMinimumApplied: boolean;
  /** Desglose por tramos (antes del tope). */
  breakdown: ServiceFeeTierBreakdown;
};

/** Convención materiales / MP: siempre entero hacia arriba. */
export function ceilServiceFeeArs(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function roundRate(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Costo de Servicio YaChanga sobre el total del presupuesto de materiales.
 *
 * Tramos (imagen producto):
 * - ≤ $200.000 → 8%
 * - $200.001–$316.667 → $16.000 + 6% × (total − 200.000)
 * - > $316.667 → tope fijo $23.000
 *
 * Mínimo: $5.000 (si el tramo da menos, se cobra $5.000).
 * El monto cobrado siempre usa Math.ceil (100,01 → 101).
 */
export function calculateServiceFee(totalAmount: number): ServiceFeeResult {
  const total = Number(totalAmount);
  if (!Number.isFinite(total) || total <= 0) {
    return {
      serviceFee: 0,
      effectiveRate: 0,
      isCapped: false,
      isMinimumApplied: false,
      breakdown: { tier1: 0, tier2: 0 },
    };
  }

  let tier1 = 0;
  let tier2 = 0;
  let rawFee = 0;

  if (total <= YACHANGA_TIER1_LIMIT_ARS) {
    tier1 = total * YACHANGA_TIER1_RATE;
    rawFee = tier1;
  } else if (total <= YACHANGA_TIER2_CAP_BREAKPOINT_ARS) {
    tier1 = YACHANGA_TIER1_LIMIT_ARS * YACHANGA_TIER1_RATE;
    tier2 = (total - YACHANGA_TIER1_LIMIT_ARS) * YACHANGA_TIER2_RATE;
    rawFee = tier1 + tier2;
  } else {
    tier1 = YACHANGA_TIER1_LIMIT_ARS * YACHANGA_TIER1_RATE;
    tier2 = YACHANGA_SERVICE_FEE_CAP_ARS - tier1;
    rawFee = YACHANGA_SERVICE_FEE_CAP_ARS;
  }

  const ceiled = ceilServiceFeeArs(rawFee);
  const withMin = Math.max(ceiled, YACHANGA_SERVICE_FEE_MIN_ARS);
  const isCapped = withMin >= YACHANGA_SERVICE_FEE_CAP_ARS || total > YACHANGA_TIER2_CAP_BREAKPOINT_ARS;
  const serviceFee = Math.min(withMin, YACHANGA_SERVICE_FEE_CAP_ARS);

  return {
    serviceFee,
    effectiveRate: roundRate((serviceFee / total) * 100),
    isCapped,
    isMinimumApplied: ceiled < YACHANGA_SERVICE_FEE_MIN_ARS && serviceFee >= YACHANGA_SERVICE_FEE_MIN_ARS,
    breakdown: {
      tier1: ceilServiceFeeArs(tier1),
      tier2: ceilServiceFeeArs(tier2),
    },
  };
}
