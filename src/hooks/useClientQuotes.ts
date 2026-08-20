import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import {
  acceptQuoteAndCreateOrder,
  fetchClientMaterialRequests,
  fetchClientQuotesForRequest,
  rejectMaterialQuote,
} from '../services/clientQuotesSupabase';
import type {
  AcceptQuoteResult,
  ClientMaterialRequestSummary,
  ClientQuoteRubroGroup,
  MaterialRequestStatus,
} from '../types/materials';

export function useClientMaterialRequests(enabled = true) {
  const [requests, setRequests] = useState<ClientMaterialRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!enabled) {
        setRequests([]);
        setLoading(false);
        return;
      }
      if (!isSupabaseConfigured()) {
        setError('Supabase no está configurado.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const list = await fetchClientMaterialRequests();
        if (!cancelled) setRequests(list);
      } catch (e) {
        if (!cancelled) {
          setRequests([]);
          setError(e instanceof Error ? e.message : 'No se pudieron cargar tus pedidos.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [enabled, token]);

  return { requests, loading, error, refresh };
}

export function useClientCompareQuotes(requestId: string, enabled = true) {
  const [requestTitle, setRequestTitle] = useState('');
  const [requestStatus, setRequestStatus] = useState<MaterialRequestStatus | null>(null);
  const [groups, setGroups] = useState<ClientQuoteRubroGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!enabled || !requestId) {
        setGroups([]);
        setLoading(false);
        return;
      }
      if (!isSupabaseConfigured()) {
        setError('Supabase no está configurado.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await fetchClientQuotesForRequest(requestId);
        if (cancelled) return;
        setRequestTitle(result.requestTitle);
        setRequestStatus(result.requestStatus);
        setGroups(result.groups);
      } catch (e) {
        if (!cancelled) {
          setGroups([]);
          setError(e instanceof Error ? e.message : 'No se pudieron cargar las cotizaciones.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [enabled, requestId, token]);

  return { requestTitle, requestStatus, groups, loading, error, refresh };
}

export function useAcceptClientQuote() {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    async (
      quoteId: string,
      acceptedItemIds: string[],
      includeFreight = true,
    ): Promise<AcceptQuoteResult> => {
      setError(null);
      if (!isSupabaseConfigured()) {
        const msg = 'Supabase no está configurado.';
        setError(msg);
        throw new Error(msg);
      }
      setAccepting(true);
      try {
        return await acceptQuoteAndCreateOrder(quoteId, acceptedItemIds, includeFreight);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'No se pudo aceptar la cotización.';
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      } finally {
        setAccepting(false);
      }
    },
    [],
  );

  const reject = useCallback(async (quoteId: string) => {
    setError(null);
    if (!isSupabaseConfigured()) {
      const msg = 'Supabase no está configurado.';
      setError(msg);
      throw new Error(msg);
    }
    setAccepting(true);
    try {
      await rejectMaterialQuote(quoteId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo rechazar la cotización.';
      setError(msg);
      throw e instanceof Error ? e : new Error(msg);
    } finally {
      setAccepting(false);
    }
  }, []);

  return { accept, reject, accepting, error };
}
