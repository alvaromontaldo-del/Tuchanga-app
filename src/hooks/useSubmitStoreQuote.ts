import { useCallback, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import {
  parsePriceText,
  submitStoreQuote,
  type SubmitStoreQuoteInput,
  type SubmitStoreQuoteItemInput,
} from '../services/storeQuotesSupabase';
import type { FreightType, MaterialRequestItem } from '../types/materials';
import {
  CONTACT_MODERATION_POLICY_MESSAGE,
  validateContactInfo,
} from '../utils/contactModeration';

export type QuoteVariantDraft = {
  label: string;
  priceText: string;
};

export type QuoteItemDraftState = {
  inStock: boolean;
  /** 1 a 3 opciones (marcas/precios) para el mismo ítem pedido. */
  variants: QuoteVariantDraft[];
  itemNote: string;
};

export function emptyQuoteItemDraft(): QuoteItemDraftState {
  return {
    inStock: true,
    variants: [{ label: '', priceText: '' }],
    itemNote: '',
  };
}

type SubmitArgs = {
  requestId: string;
  storeId: string;
  clientId?: string | null;
  freightType: FreightType;
  freightCostText: string;
  notes: string;
  items: MaterialRequestItem[];
  /** Estado por request_item_id. */
  itemDrafts: Record<string, QuoteItemDraftState>;
};

/**
 * Envía presupuesto del comercio → quotes (+ client_id para bandeja del cliente).
 */
export function useSubmitStoreQuote() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (args: SubmitArgs) => {
    setError(null);
    if (!isSupabaseConfigured()) {
      const msg = 'Supabase no está configurado.';
      setError(msg);
      throw new Error(msg);
    }

    const notesMod = validateContactInfo(args.notes);
    if (notesMod.blocked) {
      const msg = notesMod.message ?? CONTACT_MODERATION_POLICY_MESSAGE;
      setError(msg);
      throw new Error(msg);
    }

    const quoteItems: SubmitStoreQuoteItemInput[] = [];
    for (const item of args.items) {
      const draft = args.itemDrafts[item.id] ?? emptyQuoteItemDraft();
      const variants = (draft.variants.length > 0 ? draft.variants : [{ label: '', priceText: '' }]).slice(
        0,
        3,
      );

      if (!draft.inStock && variants.every((v) => !v.label.trim() && !parsePriceText(v.priceText))) {
        quoteItems.push({
          requestItemId: item.id,
          unitPrice: 0,
          inStock: false,
          alternativeDescription: null,
          itemNote: draft.itemNote.trim() || null,
          variantIndex: 1,
          variantLabel: null,
        });
        continue;
      }

      let variantIndex = 0;
      for (const v of variants) {
        const label = v.label.trim();
        const labelMod = label ? validateContactInfo(label) : null;
        if (labelMod?.blocked) {
          const msg = labelMod.message ?? CONTACT_MODERATION_POLICY_MESSAGE;
          setError(msg);
          throw new Error(msg);
        }
        const noteMod = draft.itemNote.trim()
          ? validateContactInfo(draft.itemNote)
          : null;
        if (noteMod?.blocked) {
          const msg = noteMod.message ?? CONTACT_MODERATION_POLICY_MESSAGE;
          setError(msg);
          throw new Error(msg);
        }

        if (!draft.inStock && !label) {
          // Sin stock y sin etiqueta de alternativa: omitir esta fila vacía.
          continue;
        }

        const price = parsePriceText(v.priceText);
        if (price == null || (label && price <= 0) || (draft.inStock && price == null)) {
          if (draft.inStock || label) {
            const msg = label
              ? `Completá el precio de “${label}” (${item.description}).`
              : `Completá el precio de “${item.description}”.`;
            setError(msg);
            throw new Error(msg);
          }
          continue;
        }
        if (draft.inStock && (price == null || price < 0)) {
          const msg = `Completá el precio de “${item.description}”.`;
          setError(msg);
          throw new Error(msg);
        }

        variantIndex += 1;
        if (variantIndex > 3) break;
        quoteItems.push({
          requestItemId: item.id,
          unitPrice: price ?? 0,
          inStock: draft.inStock,
          alternativeDescription: !draft.inStock && label ? label : null,
          itemNote: variantIndex === 1 ? draft.itemNote.trim() || null : null,
          variantIndex,
          variantLabel: label || null,
        });
      }

      if (variantIndex === 0) {
        if (!draft.inStock) {
          quoteItems.push({
            requestItemId: item.id,
            unitPrice: 0,
            inStock: false,
            alternativeDescription: null,
            itemNote: draft.itemNote.trim() || null,
            variantIndex: 1,
            variantLabel: null,
          });
        } else {
          const msg = `Completá al menos una opción con precio para “${item.description}”.`;
          setError(msg);
          throw new Error(msg);
        }
      }
    }

    let freightCost = 0;
    if (args.freightType === 'cost') {
      const parsed = parsePriceText(args.freightCostText);
      if (parsed == null) {
        const msg = 'Ingresá el costo del flete.';
        setError(msg);
        throw new Error(msg);
      }
      freightCost = parsed;
    }

    const payload: SubmitStoreQuoteInput = {
      requestId: args.requestId,
      storeId: args.storeId,
      clientId: args.clientId,
      freightType: args.freightType,
      freightCost,
      notes: args.notes,
      items: quoteItems,
    };

    setSubmitting(true);
    try {
      return await submitStoreQuote(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar el presupuesto.';
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, error };
}
