import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import {
  fetchStoreBoardCards,
  fetchStoreIncomingRequests,
  fetchStoreRequestDetail,
  fetchMyStores,
} from '../services/storeQuotesSupabase';
import type {
  MyStoreSummary,
  StoreBoardCard,
  StoreIncomingRequest,
  StoreRequestDetail,
} from '../types/materials';

export function useMyStores(enabled = true) {
  const [stores, setStores] = useState<MyStoreSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!enabled) {
        setStores([]);
        setLoading(false);
        return;
      }
      if (!isSupabaseConfigured()) {
        setStores([]);
        setError('Supabase no está configurado.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const list = await fetchMyStores();
        if (!cancelled) setStores(list);
      } catch (e) {
        if (!cancelled) {
          setStores([]);
          setError(e instanceof Error ? e.message : 'No se pudieron cargar tus comercios.');
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

  return { stores, loading, error, refresh, hasStore: stores.length > 0 };
}

export function useStoreIncomingRequests(enabled = true) {
  const [requests, setRequests] = useState<StoreIncomingRequest[]>([]);
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
        setRequests([]);
        setError('Supabase no está configurado.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const list = await fetchStoreIncomingRequests();
        if (!cancelled) setRequests(list);
      } catch (e) {
        if (!cancelled) {
          setRequests([]);
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los pedidos.');
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

export function useStoreBoardCards(enabled = true) {
  const [cards, setCards] = useState<StoreBoardCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((n) => n + 1), []);

  const refreshSilent = useCallback(async () => {
    if (!enabled || !isSupabaseConfigured()) return;
    try {
      const list = await fetchStoreBoardCards();
      setCards(list);
    } catch {
      /* silent */
    }
  }, [enabled]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!enabled) {
        setCards([]);
        setLoading(false);
        return;
      }
      if (!isSupabaseConfigured()) {
        setCards([]);
        setError('Supabase no está configurado.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const list = await fetchStoreBoardCards();
        if (!cancelled) setCards(list);
      } catch (e) {
        if (!cancelled) {
          setCards([]);
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los pedidos.');
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

  return { cards, loading, error, refresh, refreshSilent };
}

export function useStoreRequestDetail(params: {
  requestId: string;
  storeId: string;
  enabled?: boolean;
}) {
  const enabled = params.enabled !== false;
  const [detail, setDetail] = useState<StoreRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!enabled || !params.requestId || !params.storeId) {
        setDetail(null);
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
        const data = await fetchStoreRequestDetail({
          requestId: params.requestId,
          storeId: params.storeId,
        });
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) {
          setDetail(null);
          setError(e instanceof Error ? e.message : 'No se pudo cargar el pedido.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [enabled, params.requestId, params.storeId, token]);

  return { detail, loading, error, refresh };
}
