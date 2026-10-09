/**
 * Cotizaciones de materiales que el cliente ya rechazó no se listan
 * ni ofrecen el botón «Ver cotizaciones».
 */

export type MaterialQuoteStatusRow = {
  status: string;
  storeId?: string | null;
};

export function isRejectedMaterialQuote(status: string | null | undefined): boolean {
  return status === 'rejected';
}

export function visibleMaterialQuotes<T extends { status: string }>(quotes: readonly T[]): T[] {
  return quotes.filter((q) => !isRejectedMaterialQuote(q.status));
}

/**
 * null = todavía no llegó el estado real: no ocultar el botón por las dudas.
 * Si todas las que conocemos están rechazadas, no queda nada para ver.
 */
export function materialQuoteChatCard(
  quotes: readonly MaterialQuoteStatusRow[] | null,
  fallback: { quoteCount: number; storeCount: number },
): { show: boolean; quoteCount: number; storeCount: number } {
  if (quotes == null) {
    return {
      show: true,
      quoteCount: fallback.quoteCount,
      storeCount: fallback.storeCount,
    };
  }
  const visible = visibleMaterialQuotes(quotes);
  if (visible.length === 0) {
    return { show: false, quoteCount: 0, storeCount: 0 };
  }
  const stores = new Set(
    visible
      .map((q) => (q.storeId ?? '').trim())
      .filter((id) => id.length > 0),
  );
  return {
    show: true,
    quoteCount: visible.length,
    storeCount: Math.max(stores.size, visible.length > 0 ? 1 : 0),
  };
}

/**
 * Un pedido cuyas cotizaciones están todas rechazadas no se ofrece en la lista.
 * Sin cotizaciones (el comercio todavía no respondió) sigue visible.
 * null = ocultar el pedido.
 */
export function activeMaterialRequestQuoteCount(
  quotes: readonly { status?: string | null }[],
): number | null {
  if (quotes.length > 0 && quotes.every((q) => isRejectedMaterialQuote(q.status))) {
    return null;
  }
  return quotes.filter((q) => !isRejectedMaterialQuote(q.status)).length;
}
