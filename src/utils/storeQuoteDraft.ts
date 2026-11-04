import type { MaterialRequestItem } from '../types/materials';
import { parseArsInput } from './formatMoney';

export type QuoteVariantDraft = {
  label: string;
  priceText: string;
};

export type QuoteItemDraftState = {
  inStock: boolean;
  /** Con stock: hasta 3 marcas. Sin stock: solo la primera es el producto alternativo. */
  variants: QuoteVariantDraft[];
  itemNote: string;
};

export type BuiltStoreQuoteItem = {
  requestItemId: string;
  unitPrice: number;
  inStock: boolean;
  alternativeDescription: string | null;
  itemNote: string | null;
  variantIndex: number;
  variantLabel: string | null;
};

/** Solo lectura: «Sin stock» cuando no hay; con stock no se muestra badge. */
export function storeReadonlyStockCaption(inStock: boolean): 'Sin stock' | null {
  return inStock ? null : 'Sin stock';
}

/**
 * Caption de la variante en solo lectura.
 * Vacío = una sola variante sin marca: no decir «Precio», solo el valor a la derecha.
 * Varias variantes sin marca siguen como «Opción N».
 */
/**
 * Cotizadas, un solo precio sin marca: el valor va arriba a la derecha,
 * en la misma fila del nombre. Con marca, varias opciones o sin stock
 * el precio sigue en la fila de la variante.
 */
export function storeReadonlyPriceOnTitle(input: {
  inStock: boolean;
  variantCount: number;
  label: string;
}): boolean {
  return input.inStock && input.variantCount === 1 && input.label.trim().length === 0;
}

export function storeReadonlyPriceCaption(input: {
  inStock: boolean;
  label: string;
  variantCount: number;
  index: number;
}): string {
  const brand = input.label.trim();
  if (!input.inStock) return brand ? 'Alternativa' : 'Sin alternativa';
  if (brand) return brand;
  if (input.variantCount > 1) return `Opción ${input.index + 1}`;
  return '';
}

export function emptyQuoteItemDraft(): QuoteItemDraftState {
  return {
    inStock: true,
    variants: [{ label: '', priceText: '' }],
    itemNote: '',
  };
}

function parseDraftPrice(text: string): number | null {
  return parseArsInput(text);
}

function unavailableRow(item: MaterialRequestItem, note: string | null): BuiltStoreQuoteItem {
  return {
    requestItemId: item.id,
    unitPrice: 0,
    inStock: false,
    alternativeDescription: null,
    itemNote: note,
    variantIndex: 1,
    variantLabel: null,
  };
}

/**
 * Arma las filas de la cotización.
 * Sin stock no se manda el ítem pedido como marca seleccionable:
 * o queda sin precio (el cliente no puede marcarlo) o se manda un solo reemplazo.
 */
export function buildStoreQuoteItemRows(
  items: MaterialRequestItem[],
  itemDrafts: Record<string, QuoteItemDraftState>,
): BuiltStoreQuoteItem[] {
  const quoteItems: BuiltStoreQuoteItem[] = [];

  for (const item of items) {
    const draft = itemDrafts[item.id] ?? emptyQuoteItemDraft();
    const note = draft.itemNote.trim() || null;
    const variants = (
      draft.variants.length > 0 ? draft.variants : [{ label: '', priceText: '' }]
    ).slice(0, 3);

    if (!draft.inStock) {
      const alt = variants[0] ?? { label: '', priceText: '' };
      const label = alt.label.trim();
      const price = parseDraftPrice(alt.priceText);
      if (!label && (price == null || price === 0)) {
        quoteItems.push(unavailableRow(item, note));
        continue;
      }
      if (!label || price == null || price <= 0) {
        throw new Error(
          `Para sugerir un alternativo de “${item.description}”, completá el producto y un precio mayor a 0. Si no tenés reemplazo, dejá los dos campos vacíos.`,
        );
      }
      quoteItems.push({
        requestItemId: item.id,
        unitPrice: price,
        inStock: false,
        alternativeDescription: label,
        itemNote: note,
        variantIndex: 1,
        variantLabel: label,
      });
      continue;
    }

    let variantIndex = 0;
    for (const variant of variants) {
      const label = variant.label.trim();
      const price = parseDraftPrice(variant.priceText);
      if (price == null || (label && price <= 0)) {
        const msg = label
          ? `Completá el precio de “${label}” (${item.description}).`
          : `Completá el precio de “${item.description}”.`;
        throw new Error(msg);
      }
      if (price < 0) {
        throw new Error(`Completá el precio de “${item.description}”.`);
      }
      variantIndex += 1;
      if (variantIndex > 3) break;
      quoteItems.push({
        requestItemId: item.id,
        unitPrice: price,
        inStock: true,
        alternativeDescription: null,
        itemNote: variantIndex === 1 ? note : null,
        variantIndex,
        variantLabel: label || null,
      });
    }

    if (variantIndex === 0) {
      throw new Error(`Completá al menos una opción con precio para “${item.description}”.`);
    }
  }

  return quoteItems;
}
