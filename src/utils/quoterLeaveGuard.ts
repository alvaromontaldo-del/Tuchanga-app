/** Pop-up al salir del cotizador con datos sin enviar (#117). */

export const QUOTER_LEAVE_TITLE = '¿Seguro que querés salir del cotizador?';

export type ServiceQuoteFields = {
  amountText: string;
  detail: string;
  warrantyOn: boolean;
  warrantyDaysText: string;
};

export const EMPTY_SERVICE_QUOTE: ServiceQuoteFields = {
  amountText: '',
  detail: '',
  warrantyOn: false,
  warrantyDaysText: '',
};

function sameText(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** Sucio si cambió respecto del valor con el que se abrió (vacío en un alta). */
export function serviceQuoteIsDirty(
  current: ServiceQuoteFields,
  baseline: ServiceQuoteFields = EMPTY_SERVICE_QUOTE,
): boolean {
  return (
    !sameText(current.amountText, baseline.amountText) ||
    !sameText(current.detail, baseline.detail) ||
    current.warrantyOn !== baseline.warrantyOn ||
    !sameText(current.warrantyDaysText, baseline.warrantyDaysText)
  );
}

export function recotizarDraftIsDirty(input: { amountText: string; fundamentos: string }): boolean {
  return input.amountText.trim().length > 0 || input.fundamentos.trim().length > 0;
}

export function materialRequestIsDirty(input: {
  descriptions: string[];
  itemCount: number;
  rubroTouched: boolean;
}): boolean {
  if (input.rubroTouched) return true;
  if (input.itemCount > 1) return true;
  return input.descriptions.some((description) => description.trim().length > 0);
}

export type StoreQuoteDirtyItem = {
  inStock: boolean;
  itemNote: string;
  variants: Array<{ label: string; priceText: string }>;
};

/** Un presupuesto ya enviado no se vuelve a confirmar. El alta vacía tampoco. */
export function storeQuoteDraftIsDirty(input: {
  locked: boolean;
  freightType: string;
  freightCostText: string;
  notes: string;
  items: StoreQuoteDirtyItem[];
}): boolean {
  if (input.locked) return false;
  if (input.freightType !== 'pickup') return true;
  if (input.freightCostText.trim() || input.notes.trim()) return true;
  return input.items.some((item) => {
    if (!item.inStock) return true;
    if (item.itemNote.trim()) return true;
    if (item.variants.length > 1) return true;
    return item.variants.some((variant) => variant.label.trim() || variant.priceText.trim());
  });
}

/** Enviando o ya enviado: se sale sin pop-up. */
export function quoterLeaveShouldAsk(input: {
  dirty: boolean;
  submitting: boolean;
  submitted: boolean;
}): boolean {
  if (input.submitting || input.submitted) return false;
  return input.dirty;
}
