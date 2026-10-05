import { useCallback, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import {
  parsePriceText,
  submitStoreQuote,
  type SubmitStoreQuoteInput,
} from '../services/storeQuotesSupabase';
import type { FreightType, MaterialRequestItem } from '../types/materials';
import {
  buildStoreQuoteItemRows,
  emptyQuoteItemDraft,
  type QuoteItemDraftState,
  type QuoteVariantDraft,
} from '../utils/storeQuoteDraft';

export type { QuoteItemDraftState, QuoteVariantDraft };
export { emptyQuoteItemDraft };

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

    let quoteItems;
    try {
      quoteItems = buildStoreQuoteItemRows(args.items, args.itemDrafts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Revisá los ítems del presupuesto.';
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
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
