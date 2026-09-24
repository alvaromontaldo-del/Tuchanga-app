import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../config/supabase';
import { fetchClientMaterialPickups } from '../services/clientMaterialPickupsSupabase';
import type { ClientPickupCardModel } from '../utils/clientMaterialPickups';

export function useClientMaterialPickups(enabled = true) {
  const [orders, setOrders] = useState<ClientPickupCardModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!enabled) {
        setOrders([]);
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
        const list = await fetchClientMaterialPickups();
        if (!cancelled) setOrders(list);
      } catch (e) {
        if (!cancelled) {
          setOrders([]);
          setError(e instanceof Error ? e.message : 'No se pudieron cargar las solicitudes.');
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

  return { orders, loading, error, refresh };
}
