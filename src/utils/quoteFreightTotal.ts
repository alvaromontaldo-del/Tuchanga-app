import type { FreightType } from '../types/materials';

export type QuoteFreightDisplay = {
  /** Monto de flete que entra en el TOTAL. 0 si el cliente no lo eligió. */
  freightAmount: number;
  freightRowLabel: string;
  /** Materiales, más el flete solo cuando fue elegido. */
  total: number;
  freightIncluded: boolean;
};

function money(n: number): number {
  return Math.max(0, Math.ceil(Number(n) || 0));
}

/**
 * TOTAL de una cotización de materiales.
 * El flete cotizado solo se suma si el cliente lo eligió (checkbox) o si la
 * orden ya lo guardó en `include_freight`. Retiro en local deja el flete en 0.
 */
export function quoteFreightDisplay(params: {
  materialsSubtotal: number;
  freightType: FreightType;
  /** Costo de flete cotizado por el comercio. */
  quotedFreightCost: number;
  /**
   * Decisión persistida en la orden.
   * null = todavía no hay orden.
   */
  orderIncludeFreight: boolean | null;
  /** Checkbox "Incluir flete" mientras la cotización sigue abierta. */
  uiIncludeFreight: boolean;
  /** true si el cliente puede marcar o desmarcar el flete ahora. */
  canChooseFreight: boolean;
}): QuoteFreightDisplay {
  const materials = money(params.materialsSubtotal);
  const quoted = money(params.quotedFreightCost);

  if (params.freightType === 'pickup') {
    return {
      freightAmount: 0,
      freightRowLabel: 'Retiro en local',
      total: materials,
      freightIncluded: false,
    };
  }

  if (params.freightType === 'free') {
    return {
      freightAmount: 0,
      freightRowLabel: 'Flete gratis',
      total: materials,
      freightIncluded: true,
    };
  }

  const offered = quoted > 0;
  let included = false;
  if (params.orderIncludeFreight != null) {
    included = params.orderIncludeFreight && offered;
  } else if (params.canChooseFreight) {
    included = params.uiIncludeFreight && offered;
  } else {
    // Vista de la oferta (sin orden y sin checkbox): el total cotizado incluye el flete.
    included = offered;
  }

  return {
    freightAmount: included ? quoted : 0,
    freightRowLabel: included ? 'Flete' : 'Flete (retiro en local — no incluido)',
    total: materials + (included ? quoted : 0),
    freightIncluded: included,
  };
}
