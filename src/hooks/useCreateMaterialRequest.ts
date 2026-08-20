import { useCallback, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import {
  createMaterialRequestWithTargets,
  fetchStoresByRubroId,
} from '../services/materialRequestsSupabase';
import type { MaterialItemDraft } from '../types/materials';

type SubmitParams = {
  professionalId: string;
  clientId?: string | null;
  clientLat?: number | null;
  clientLng?: number | null;
  clientAddress?: string | null;
  conversationId?: string | null;
  title: string;
  items: MaterialItemDraft[];
  rubroId: string;
};

/**
 * Envía la solicitud a TODOS los comercios elegibles del rubro (sin filtro de distancia).
 */
export function useCreateMaterialRequest() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (params: SubmitParams) => {
    setError(null);

    if (!isSupabaseConfigured()) {
      const msg = 'Supabase no está configurado.';
      setError(msg);
      throw new Error(msg);
    }
    const rubroId = params.rubroId.trim();
    if (!rubroId) {
      const msg = 'Seleccioná un rubro.';
      setError(msg);
      throw new Error(msg);
    }

    setSubmitting(true);
    try {
      const stores = await fetchStoresByRubroId(rubroId);
      if (stores.length < 1) {
        const msg = 'No hay comercios activos en ese rubro.';
        setError(msg);
        throw new Error(msg);
      }

      const result = await createMaterialRequestWithTargets({
        professionalId: params.professionalId,
        clientId: params.clientId,
        clientLat: params.clientLat,
        clientLng: params.clientLng,
        clientAddress: params.clientAddress,
        conversationId: params.conversationId,
        title: params.title,
        items: params.items,
        storeIds: stores.map((s) => s.id),
        rubroId,
      });
      return { ...result, storeCount: result.storeCount };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar la solicitud.';
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting, error };
}
