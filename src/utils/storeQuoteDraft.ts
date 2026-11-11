import type { MaterialRequestItem } from '../types/materials';
import { parseArsInput } from './formatMoney';

export type QuoteVariantDraft = {
  label: string;
  priceText: string;
};

export type QuoteItemDraftState = {
  inStock: boolean;
  /** Precio del ítem, en la misma fila del nombre. Vacío si todavía no se cargó. */
  itemPriceText: string;
  /** Con stock: hasta 3 marcas opcionales. Sin stock: solo la primera es el reemplazo. */
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

/** Alta: «Cotizar pedido». Ver cotización: el header junto al atrás dice «Volver». */
export function storeQuoteScreenTitle(viewingSentQuote: boolean): 'Volver' | 'Cotizar pedido' {
  return viewingSentQuote ? 'Volver' : 'Cotizar pedido';
}

export type ChosenStoreReplacement = {
  label: string;
  priceText: string;
};

/**
 * Reemplazo a mostrar solo, con su propio nombre y precio.
 * Una sola alternativa: alcanza `clientDecision === accepted`.
 * Varias: solo si `variantDecisions` marca exactamente una como accepted.
 * null = vista completa (con stock, sin elección inequívoca, o más de una aceptada).
 * No elige ni recalcula: devuelve el texto de esa variante o null.
 */
export function storeChosenReplacementLabel(input: {
  inStock: boolean;
  clientDecision: 'pending' | 'accepted' | 'rejected';
  variants: ReadonlyArray<{ label: string; priceText: string }>;
  variantDecisions?: ReadonlyArray<'pending' | 'accepted' | 'rejected' | null | undefined>;
}): ChosenStoreReplacement | null {
  if (input.inStock || input.variants.length === 0) return null;

  const picked =
    input.variants.length === 1
      ? input.clientDecision === 'accepted'
        ? input.variants[0]
        : null
      : exactlyOneAccepted(input.variants, input.variantDecisions);

  if (!picked) return null;
  const label = picked.label.trim();
  if (!label) return null;
  return { label, priceText: picked.priceText };
}

function exactlyOneAccepted(
  variants: ReadonlyArray<{ label: string; priceText: string }>,
  decisions: ReadonlyArray<'pending' | 'accepted' | 'rejected' | null | undefined> | undefined,
): { label: string; priceText: string } | null {
  const marks = decisions ?? [];
  let chosen: { label: string; priceText: string } | null = null;
  for (let i = 0; i < variants.length; i += 1) {
    if (marks[i] !== 'accepted') continue;
    if (chosen) return null;
    chosen = variants[i];
  }
  return chosen;
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
    itemPriceText: '',
    variants: [],
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

    const itemPrice = parseDraftPrice(draft.itemPriceText ?? '');
    if (itemPrice == null || itemPrice <= 0) {
      throw new Error(`Completá el precio de “${item.description}”.`);
    }

    const brands: Array<{ label: string; price: number }> = [];
    for (const variant of draft.variants.slice(0, 3)) {
      const label = variant.label.trim();
      const price = parseDraftPrice(variant.priceText);
      // Sin precio la marca no se cargó: se ignora, aunque tenga nombre.
      if (price == null || price <= 0) continue;
      if (!label) {
        throw new Error(
          `Si cargás un precio de marca en “${item.description}”, el nombre de la marca es obligatorio.`,
        );
      }
      brands.push({ label, price });
    }

    // Sin marcas el precio queda en la variante 1, como las cotizaciones de un solo precio.
    // Con marcas, el precio del ítem es la variante 0 y cada marca ocupa 1..3.
    quoteItems.push({
      requestItemId: item.id,
      unitPrice: itemPrice,
      inStock: true,
      alternativeDescription: null,
      itemNote: note,
      variantIndex: brands.length > 0 ? 0 : 1,
      variantLabel: null,
    });
    brands.forEach((brand, index) => {
      quoteItems.push({
        requestItemId: item.id,
        unitPrice: brand.price,
        inStock: true,
        alternativeDescription: null,
        itemNote: null,
        variantIndex: index + 1,
        variantLabel: brand.label,
      });
    });
  }

  return quoteItems;
}
