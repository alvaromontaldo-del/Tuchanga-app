import { materialRequestIsDirty } from './quoterLeaveGuard';

/** Borrador de la lista de materiales, por usuario y conversación. */
export type MaterialRequestDraft = {
  version: 1;
  rubroId: string | null;
  rubroTouched: boolean;
  items: Array<{ localId: string; description: string }>;
};

export type MaterialRequestDraftScope = {
  userId: string;
  conversationId?: string | null;
  clientId?: string | null;
};

export type MaterialRequestDraftStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export function materialRequestDraftKey(scope: MaterialRequestDraftScope): string | null {
  const userId = scope.userId.trim();
  if (!userId) return null;
  const conversationId = scope.conversationId?.trim() ?? '';
  if (conversationId) return `material-request-draft:v1:${userId}:c:${conversationId}`;
  const clientId = scope.clientId?.trim() ?? '';
  if (clientId) return `material-request-draft:v1:${userId}:p:${clientId}`;
  return null;
}

export function materialRequestDraftShouldPersist(draft: MaterialRequestDraft): boolean {
  return materialRequestIsDirty({
    descriptions: draft.items.map((item) => item.description),
    itemCount: draft.items.length,
    rubroTouched: draft.rubroTouched,
  });
}

export function parseMaterialRequestDraft(raw: string | null | undefined): MaterialRequestDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Partial<MaterialRequestDraft>;
  if (row.version !== 1 || !Array.isArray(row.items)) return null;
  const items = row.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const localId = typeof item.localId === 'string' ? item.localId.trim() : '';
    const description = typeof item.description === 'string' ? item.description : '';
    if (!localId) return [];
    return [{ localId, description }];
  });
  if (items.length === 0) return null;
  const rubroId = typeof row.rubroId === 'string' && row.rubroId.trim() ? row.rubroId.trim() : null;
  return {
    version: 1,
    rubroId,
    rubroTouched: row.rubroTouched === true,
    items,
  };
}

function cloneDraft(draft: MaterialRequestDraft): MaterialRequestDraft {
  return {
    version: 1,
    rubroId: draft.rubroId,
    rubroTouched: draft.rubroTouched,
    items: draft.items.map((item) => ({
      localId: item.localId,
      description: item.description,
    })),
  };
}

/**
 * Memoria + storage. La memoria responde al toque siguiente aunque
 * AsyncStorage todavía no haya terminado, y un clear no lo pisa un save viejo.
 */
export function createMaterialRequestDraftStore(storage: MaterialRequestDraftStorage) {
  const memory = new Map<string, MaterialRequestDraft>();
  const generation = new Map<string, number>();

  function bump(key: string): number {
    const next = (generation.get(key) ?? 0) + 1;
    generation.set(key, next);
    return next;
  }

  async function reconcile(key: string, gen: number) {
    if (generation.get(key) === gen) return;
    const current = memory.get(key);
    try {
      if (current) await storage.setItem(key, JSON.stringify(current));
      else await storage.removeItem(key);
    } catch {
      /* el borrador en memoria sigue siendo el vigente */
    }
  }

  return {
    async load(scope: MaterialRequestDraftScope): Promise<MaterialRequestDraft | null> {
      const key = materialRequestDraftKey(scope);
      if (!key) return null;
      const cached = memory.get(key);
      if (cached) return cloneDraft(cached);
      try {
        const parsed = parseMaterialRequestDraft(await storage.getItem(key));
        if (!parsed || !materialRequestDraftShouldPersist(parsed)) return null;
        memory.set(key, parsed);
        return cloneDraft(parsed);
      } catch {
        return null;
      }
    },

    async save(scope: MaterialRequestDraftScope, draft: MaterialRequestDraft): Promise<void> {
      const key = materialRequestDraftKey(scope);
      if (!key) return;
      const gen = bump(key);
      const next = cloneDraft(draft);
      if (!materialRequestDraftShouldPersist(next)) {
        memory.delete(key);
        try {
          await storage.removeItem(key);
        } catch {
          /* no bloquea volver al chat */
        }
        await reconcile(key, gen);
        return;
      }
      memory.set(key, next);
      try {
        await storage.setItem(key, JSON.stringify(next));
      } catch {
        return;
      }
      await reconcile(key, gen);
    },

    async clear(scope: MaterialRequestDraftScope): Promise<void> {
      const key = materialRequestDraftKey(scope);
      if (!key) return;
      const gen = bump(key);
      memory.delete(key);
      try {
        await storage.removeItem(key);
      } catch {
        /* igual queda borrado en memoria */
      }
      await reconcile(key, gen);
    },
  };
}
