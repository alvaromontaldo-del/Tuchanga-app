import { useEffect, useState } from 'react';
import type { RubrosCatalogRoot } from '../data/rubrosCatalog';
import {
  loadTradeCatalog,
  peekRemoteTradeCatalog,
  readStoredTradeCatalog,
  type TradeCatalogSource,
} from '../services/professionalTradesCatalog';

export type UseTradeCatalogResult = {
  /** Null mientras no hay lista remota, caché ni respaldo. */
  catalog: RubrosCatalogRoot | null;
  source: TradeCatalogSource | null;
  loading: boolean;
};

/**
 * Lista de oficios para alta, edición y filtros del cliente.
 * No muestra `rubros.json` mientras la red todavía puede responder.
 */
export function useTradeCatalog(): UseTradeCatalogResult {
  const [catalog, setCatalog] = useState<RubrosCatalogRoot | null>(
    () => peekRemoteTradeCatalog()?.catalog ?? null,
  );
  const [source, setSource] = useState<TradeCatalogSource | null>(
    () => peekRemoteTradeCatalog()?.source ?? null,
  );
  const [loading, setLoading] = useState(() => peekRemoteTradeCatalog() == null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const warm = peekRemoteTradeCatalog() ?? (await readStoredTradeCatalog());
        if (!cancelled && warm) {
          setCatalog(warm.catalog);
          setSource(warm.source);
        }
        const resolved = await loadTradeCatalog();
        if (!cancelled) {
          setCatalog(resolved.catalog);
          setSource(resolved.source);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalog, source, loading };
}
