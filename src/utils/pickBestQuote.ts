import type { ClientQuoteCard, ClientQuoteLineItem } from '../types/materials';

/** Cotización elegible para selección parcial del cliente. */
export function isClientSelectableQuote(card: ClientQuoteCard): boolean {
  return (
    card.status === 'sent' &&
    !card.contactRevealed &&
    !(
      card.orderId != null &&
      (card.orderStatus === 'pending_deposit' || card.orderStatus === 'pending')
    )
  );
}

/**
 * Mejor propuesta por rubro: menor total; empate → más cerca.
 */
export function pickBestQuoteId(quotes: ClientQuoteCard[]): string | null {
  const candidates = quotes.filter(isClientSelectableQuote);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total;
    const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
    const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
  return sorted[0]?.quoteId ?? null;
}

/** Cliente solo puede pedir ítems con stock o con alternativa/variante con precio. */
export function isClientSelectableQuoteItem(it: {
  inStock: boolean;
  alternativeDescription: string | null;
  variantLabel?: string | null;
  unitPrice?: number;
  lineTotal?: number;
  clientDecision?: string | null;
}): boolean {
  if (it.clientDecision === 'rejected') return false;
  const price = Number(it.lineTotal ?? it.unitPrice ?? 0);
  if (!it.inStock) {
    const hasAlt = Boolean(it.alternativeDescription?.trim() || it.variantLabel?.trim());
    return hasAlt && price > 0;
  }
  return price >= 0; // con stock: precio 0 raro pero permitido si el comercio lo cotizó
}

/** Una quote_item id por request_item (la más barata seleccionable). */
export function defaultSelectedItemIds(card: ClientQuoteCard): Set<string> {
  const byRequest = new Map<string, ClientQuoteLineItem[]>();
  for (const it of card.items) {
    if (it.clientDecision === 'rejected') continue;
    if (!isClientSelectableQuoteItem(it)) continue;
    const list = byRequest.get(it.requestItemId) ?? [];
    list.push(it);
    byRequest.set(it.requestItemId, list);
  }
  const selected = new Set<string>();
  for (const list of byRequest.values()) {
    const preferred =
      list.find((it) => it.clientDecision === 'accepted') ??
      [...list].sort((a, b) => a.lineTotal - b.lineTotal)[0];
    if (preferred?.quoteItemId) selected.add(preferred.quoteItemId);
  }
  return selected;
}

export function defaultIncludeFreight(card: ClientQuoteCard): boolean {
  return card.freightType === 'cost' && card.freightCost > 0;
}

/** Agrupa variantes del mismo request_item. */
export function groupQuoteItemsByRequest(
  items: ClientQuoteLineItem[],
): Array<{ requestItemId: string; description: string; variants: ClientQuoteLineItem[] }> {
  const map = new Map<
    string,
    { requestItemId: string; description: string; variants: ClientQuoteLineItem[] }
  >();
  for (const it of items) {
    const cur = map.get(it.requestItemId);
    if (!cur) {
      map.set(it.requestItemId, {
        requestItemId: it.requestItemId,
        description: it.description,
        variants: [it],
      });
    } else {
      cur.variants.push(it);
    }
  }
  return [...map.values()];
}

/** Todas las cotizaciones todavía elegibles arrancan con la opción más barata por material. */
export function initialSelectedItemIdsByQuote(
  quotes: ClientQuoteCard[],
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const card of quotes) {
    if (!isClientSelectableQuote(card)) continue;
    out[card.quoteId] = defaultSelectedItemIds(card);
  }
  return out;
}

/** Encabezado del material. La marca va en la fila de la variante, no acá. */
export function materialGroupHeader(group: {
  description: string;
  variants: Array<Pick<ClientQuoteLineItem, 'quantity' | 'unit'>>;
}): string {
  const description = group.description.trim() || 'Material';
  const sample = group.variants[0];
  if (!sample) return description;
  const qty = Number(sample.quantity);
  const unit = (sample.unit ?? '').trim();
  if (!Number.isFinite(qty) || !unit) return description;
  const qtyLabel = Number.isInteger(qty)
    ? String(qty)
    : qty.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  return `${description} · ${qtyLabel} ${unit}`;
}

/** Etiqueta de una variante: marca, o «Precio» / alternativa si no hay marca. */
export function variantOptionLabel(it: {
  variantLabel?: string | null;
  inStock: boolean;
  alternativeDescription?: string | null;
}): string {
  const brand = it.variantLabel?.trim();
  if (brand) return brand;
  if (it.inStock) return 'Precio';
  return it.alternativeDescription?.trim() || 'Precio';
}

/** Varias opciones: radio. Una sola (aunque tenga marca): checkbox. */
export function variantSelectionControl(variantCount: number): 'radio' | 'checkbox' {
  return variantCount > 1 ? 'radio' : 'checkbox';
}

/**
 * Materiales que quedaron elegidos en dos o más comercios.
 * No se descarta ninguno: solo se avisa.
 */
export function duplicateSelectedMaterials(
  cards: Array<Pick<ClientQuoteCard, 'quoteId' | 'items'>>,
  selectedByQuote: Record<string, ReadonlySet<string> | undefined>,
): { labels: string[]; requestItemIds: Set<string> } {
  const byRequest = new Map<string, { description: string; quotes: Set<string> }>();
  for (const card of cards) {
    const ids = selectedByQuote[card.quoteId];
    if (!ids || ids.size === 0) continue;
    const seen = new Set<string>();
    for (const it of card.items) {
      if (!ids.has(it.quoteItemId) || seen.has(it.requestItemId)) continue;
      seen.add(it.requestItemId);
      const cur = byRequest.get(it.requestItemId) ?? {
        description: it.description,
        quotes: new Set<string>(),
      };
      cur.quotes.add(card.quoteId);
      if (!cur.description.trim() && it.description.trim()) cur.description = it.description;
      byRequest.set(it.requestItemId, cur);
    }
  }
  const labels: string[] = [];
  const requestItemIds = new Set<string>();
  for (const [requestItemId, entry] of byRequest) {
    if (entry.quotes.size < 2) continue;
    requestItemIds.add(requestItemId);
    const label = entry.description.trim();
    if (label) labels.push(label);
  }
  return { labels, requestItemIds };
}

export type PendingFeeCard = {
  orderId: string | null;
  orderStatus: string | null;
  contactRevealed: boolean;
  paymentGroupId: string | null;
  depositAmount: number | null;
  orderCreatedAt: string | null;
  checkoutServiceFee: number | null;
};

export type PendingServiceFeeGroup = {
  groupKey: string;
  primaryOrderId: string;
  serviceFee: number;
  storeCount: number;
};

function finitePositive(values: Array<number | null | undefined>): number[] {
  return values.filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
}

/**
 * Un botón de pago por grupo. El fee es el de material_checkouts, o si no
 * el máximo de deposit_amount: cada orden guarda el total del grupo.
 */
export function pendingServiceFeeGroups(cards: PendingFeeCard[]): PendingServiceFeeGroup[] {
  const pending = cards.filter(
    (card) =>
      Boolean(card.orderId) &&
      (card.orderStatus === 'pending_deposit' || card.orderStatus === 'pending') &&
      !card.contactRevealed,
  );
  const grouped = new Map<string, PendingFeeCard[]>();
  for (const card of pending) {
    const key = card.paymentGroupId || card.orderId || '';
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(card);
    grouped.set(key, list);
  }

  const result: Array<PendingServiceFeeGroup & { sortAt: string }> = [];
  for (const [groupKey, list] of grouped) {
    const unique = new Map<string, PendingFeeCard>();
    for (const card of list) {
      if (!card.orderId || unique.has(card.orderId)) continue;
      unique.set(card.orderId, card);
    }
    const orders = [...unique.values()].sort((a, b) => {
      const ta = a.orderCreatedAt ?? '';
      const tb = b.orderCreatedAt ?? '';
      if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      return (a.orderId ?? '').localeCompare(b.orderId ?? '');
    });
    const primary = orders[0];
    if (!primary?.orderId) continue;
    const checkoutFees = finitePositive(orders.map((card) => card.checkoutServiceFee));
    const deposits = finitePositive(orders.map((card) => card.depositAmount));
    const serviceFee =
      checkoutFees.length > 0
        ? Math.max(...checkoutFees)
        : deposits.length > 0
          ? Math.max(...deposits)
          : 0;
    result.push({
      groupKey,
      primaryOrderId: primary.orderId,
      serviceFee,
      storeCount: orders.length,
      sortAt: primary.orderCreatedAt ?? '',
    });
  }

  result.sort((a, b) => {
    if (a.sortAt && b.sortAt && a.sortAt !== b.sortAt) return a.sortAt < b.sortAt ? -1 : 1;
    if (a.sortAt && !b.sortAt) return -1;
    if (!a.sortAt && b.sortAt) return 1;
    return a.groupKey.localeCompare(b.groupKey);
  });
  return result.map((group) => ({
    groupKey: group.groupKey,
    primaryOrderId: group.primaryOrderId,
    serviceFee: group.serviceFee,
    storeCount: group.storeCount,
  }));
}

/** Un grupo: «Pagar costo de servicio $X». Varios: suma la cantidad de comercios. */
export function pendingFeePayLabel(
  feeLabel: string,
  storeCount: number,
  groupCount: number,
): string {
  const base = `Pagar costo de servicio ${feeLabel}`;
  if (groupCount <= 1) return base;
  const n = Math.max(0, Math.trunc(storeCount));
  return `${base} · ${n} comercio${n === 1 ? '' : 's'}`;
}
