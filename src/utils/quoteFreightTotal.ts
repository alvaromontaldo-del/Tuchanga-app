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

/** Normaliza el flag de la orden (boolean, 0/1 o texto de PostgREST). */
export function parseIncludeFreightFlag(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return null;
  }
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (v === 'true' || v === 't' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === 'f' || v === '0' || v === 'no') return false;
  }
  return null;
}

/**
 * Si el flete cotizado entra en el total de ESTA cotización.
 * La decisión es por orden (`include_freight`), no un flag compartido del pedido.
 * Con la selección ya cerrada no se asume el flete del comercio.
 */
export function freightIsIncluded(params: {
  materialsSubtotal: number;
  freightType: FreightType;
  quotedFreightCost: number;
  orderIncludeFreight: boolean | null;
  uiIncludeFreight: boolean;
  canChooseFreight: boolean;
  /** Orden creada o ítems ya aceptados/rechazados. */
  selectionLocked?: boolean;
  /** orders.accepted_total de esta cotización. */
  acceptedTotal?: number | null;
}): boolean {
  if (params.freightType === 'pickup') return false;
  if (params.freightType === 'free') return true;

  const materials = money(params.materialsSubtotal);
  const quoted = money(params.quotedFreightCost);
  if (quoted <= 0) return false;

  const explicit = params.orderIncludeFreight;
  const locked = params.selectionLocked === true;
  const accepted =
    params.acceptedTotal != null && Number.isFinite(Number(params.acceptedTotal))
      ? money(Number(params.acceptedTotal))
      : null;

  if (explicit === false) return false;

  // El total guardado no supera los materiales: el flete no se cobró,
  // aunque la columna haya quedado en true (default).
  if (accepted != null && accepted > 0 && accepted <= materials) return false;

  if (explicit === true) return true;

  if (accepted != null && accepted > materials) {
    const extra = accepted - materials;
    return extra + 1 >= quoted;
  }

  if (locked) return false;
  if (params.canChooseFreight) return params.uiIncludeFreight === true;
  return true;
}

/**
 * TOTAL de una cotización de materiales.
 * El flete cotizado solo se suma si el cliente lo eligió en ESA cotización.
 * Retiro en local deja el flete en 0.
 */
export function quoteFreightDisplay(params: {
  materialsSubtotal: number;
  freightType: FreightType;
  /** Costo de flete cotizado por el comercio. */
  quotedFreightCost: number;
  /**
   * Decisión persistida en la orden de esta cotización.
   * null = todavía no hay orden.
   */
  orderIncludeFreight: boolean | null;
  /** Checkbox "Incluir flete" mientras la cotización sigue abierta. */
  uiIncludeFreight: boolean;
  /** true si el cliente puede marcar o desmarcar el flete ahora. */
  canChooseFreight: boolean;
  selectionLocked?: boolean;
  acceptedTotal?: number | null;
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

  const included = freightIsIncluded(params);

  return {
    freightAmount: included ? quoted : 0,
    freightRowLabel: included ? 'Flete' : 'Flete (retiro en local — no incluido)',
    total: materials + (included ? quoted : 0),
    freightIncluded: included,
  };
}

/**
 * Checkbox visible. La orden de esta cotización manda; si no hay orden,
 * el default "con flete" aplica solo a la mejor oferta, no a las demás.
 */
export function shownIncludeFreight(
  card: {
    orderIncludeFreight: boolean | null;
    freightType: FreightType;
    freightCost: number;
  },
  stateValue: boolean | undefined,
  isBest: boolean,
): boolean {
  if (card.orderIncludeFreight != null) return card.orderIncludeFreight;
  if (typeof stateValue === 'boolean') return stateValue;
  return isBest && card.freightType === 'cost' && card.freightCost > 0;
}

export type CheckoutSelectionInput = {
  quoteId: string;
  itemIds: string[];
  quoteItemIds?: string[];
  includeFreight: boolean;
};

/** Payload de checkout: cada cotización lleva su propio include_freight. */
export function buildMaterialCheckoutPayload(selections: CheckoutSelectionInput[]) {
  return selections.map((s) => ({
    quote_id: s.quoteId,
    item_ids: s.itemIds,
    quote_item_ids: s.quoteItemIds ?? [],
    include_freight: s.includeFreight === true,
  }));
}

/**
 * Importe a cobrar por el comercio. Con ítems aceptados, el flete entra
 * solo si ESA orden lo incluyó.
 */
export function storeAmountDue(params: {
  acceptedItemsSum: number;
  hasAcceptedItems: boolean;
  allItemsSum: number;
  quotedFreightCost: number;
  freightType: FreightType;
  orderIncludeFreight: boolean | null;
  acceptedTotal: number | null;
}): number | null {
  const quoted = money(params.quotedFreightCost);
  const freightOn =
    params.orderIncludeFreight === true && params.freightType === 'cost' && quoted > 0;
  const acceptedItems = money(params.acceptedItemsSum);

  if (params.hasAcceptedItems) {
    if (params.orderIncludeFreight === true || params.orderIncludeFreight === false) {
      return money(acceptedItems + (freightOn ? quoted : 0));
    }
    if (params.acceptedTotal != null && Number(params.acceptedTotal) > 0) {
      return money(Number(params.acceptedTotal));
    }
    return acceptedItems;
  }

  if (params.acceptedTotal != null && Number(params.acceptedTotal) > 0) {
    return money(Number(params.acceptedTotal));
  }

  const previewFreight = params.freightType === 'cost' ? quoted : 0;
  const preview = money(params.allItemsSum + previewFreight);
  return preview > 0 ? preview : null;
}
