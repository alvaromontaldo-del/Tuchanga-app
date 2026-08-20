import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import { fetchNearbyStores } from '../services/materialRequestsSupabase';
import type { NearbyStore } from '../types/materials';

type Options = {
  clientLat: number | null | undefined;
  clientLng: number | null | undefined;
  enabled?: boolean;
};

/**
 * Lista comercios cercanos a la obra/domicilio del cliente.
 */
export function useNearbyStores({ clientLat, clientLng, enabled = true }: Options) {
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!enabled || clientLat == null || clientLng == null) {
        setStores([]);
        setError(null);
        setLoading(false);
        return;
      }
      if (!isSupabaseConfigured()) {
        setStores([]);
        setError('Supabase no está configurado.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const list = await fetchNearbyStores({
          clientLat,
          clientLng,
        });
        if (!cancelled) setStores(list);
      } catch (e) {
        if (!cancelled) {
          setStores([]);
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los comercios.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [clientLat, clientLng, enabled, reloadToken]);

  return { stores, loading, error, refresh };
}
