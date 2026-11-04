import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createMaterialRequestDraftStore,
  materialRequestDraftKey,
  materialRequestDraftShouldPersist,
  parseMaterialRequestDraft,
  type MaterialRequestDraft,
  type MaterialRequestDraftStorage,
} from './materialRequestDraft';

const cable: MaterialRequestDraft = {
  version: 1,
  rubroId: 'rubro-1',
  rubroTouched: true,
  items: [{ localId: 'a', description: 'Cable 2.5 mm' }],
};

function memoryStorage() {
  const rows = new Map<string, string>();
  const storage: MaterialRequestDraftStorage = {
    async getItem(key) {
      return rows.get(key) ?? null;
    },
    async setItem(key, value) {
      rows.set(key, value);
    },
    async removeItem(key) {
      rows.delete(key);
    },
  };
  return { rows, storage };
}

describe('borrador de materiales', () => {
  it('la clave separa usuario y conversación', () => {
    expect(
      materialRequestDraftKey({ userId: 'pro', conversationId: 'chat-1', clientId: 'cli' }),
    ).toBe('material-request-draft:v1:pro:c:chat-1');
    expect(
      materialRequestDraftKey({ userId: 'pro', conversationId: 'chat-2', clientId: 'cli' }),
    ).not.toBe(materialRequestDraftKey({ userId: 'pro', conversationId: 'chat-1' }));
    expect(materialRequestDraftKey({ userId: 'otro', conversationId: 'chat-1' })).not.toBe(
      materialRequestDraftKey({ userId: 'pro', conversationId: 'chat-1' }),
    );
    expect(materialRequestDraftKey({ userId: 'pro', clientId: 'cli' })).toBe(
      'material-request-draft:v1:pro:p:cli',
    );
    expect(materialRequestDraftKey({ userId: '  ' })).toBeNull();
  });

  it('no persiste la lista vacía y restaura la que tiene datos', () => {
    expect(
      materialRequestDraftShouldPersist({
        version: 1,
        rubroId: null,
        rubroTouched: false,
        items: [{ localId: 'a', description: '  ' }],
      }),
    ).toBe(false);
    expect(materialRequestDraftShouldPersist(cable)).toBe(true);
    expect(parseMaterialRequestDraft('no-json')).toBeNull();
    expect(parseMaterialRequestDraft(JSON.stringify({ version: 2, items: [] }))).toBeNull();
    expect(parseMaterialRequestDraft(JSON.stringify(cable))).toEqual(cable);
  });

  it('guarda, restaura y limpia por conversación', async () => {
    const { rows, storage } = memoryStorage();
    const store = createMaterialRequestDraftStore(storage);
    const uno = { userId: 'pro', conversationId: 'chat-1' };
    const dos = { userId: 'pro', conversationId: 'chat-2' };

    await store.save(uno, cable);
    await store.save(dos, {
      ...cable,
      items: [{ localId: 'b', description: 'Codo 90' }],
    });

    expect((await store.load(uno))?.items[0]?.description).toBe('Cable 2.5 mm');
    expect((await store.load(dos))?.items[0]?.description).toBe('Codo 90');
    expect(rows.size).toBe(2);

    await store.clear(uno);
    expect(await store.load(uno)).toBeNull();
    expect((await store.load(dos))?.items[0]?.description).toBe('Codo 90');

    await store.save(dos, {
      version: 1,
      rubroId: null,
      rubroTouched: false,
      items: [{ localId: 'b', description: '' }],
    });
    expect(await store.load(dos)).toBeNull();
    expect(rows.size).toBe(0);
  });

  it('la memoria responde antes de que el storage termine y un clear gana', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stored: string | null = null;
    const storage: MaterialRequestDraftStorage = {
      async getItem() {
        return stored;
      },
      async setItem(_key, value) {
        await gate;
        stored = value;
      },
      async removeItem() {
        stored = null;
      },
    };
    const store = createMaterialRequestDraftStore(storage);
    const scope = { userId: 'pro', conversationId: 'chat-1' };
    const pending = store.save(scope, cable);
    expect((await store.load(scope))?.rubroId).toBe('rubro-1');
    await store.clear(scope);
    release();
    await pending;
    expect(await store.load(scope)).toBeNull();
    expect(stored).toBeNull();
  });

  it('la pantalla guarda al volver y limpia al enviar', () => {
    const screen = readFileSync('src/screens/materials/CreateMaterialRequestScreen.tsx', 'utf8');
    expect(screen).toContain('loadMaterialRequestDraft');
    expect(screen).toContain('saveMaterialRequestDraft');
    expect(screen).toContain('clearMaterialRequestDraft');
    expect(screen).toContain('iosBlockGesture: rubroPickerOpen');
    const modal = readFileSync('src/components/common/SingleSelectModal.tsx', 'utf8');
    expect(modal).toContain('onDismiss');
    expect(modal).toContain("Platform.OS === 'ios'");
  });
});
