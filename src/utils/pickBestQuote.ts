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
