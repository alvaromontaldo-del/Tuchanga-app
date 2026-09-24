import { describe, expect, it } from 'vitest';
import { normalizePostImageUrls } from '../types/feed';
import { asText, isRenderableUri, listKey, settle } from './safeAsync';

describe('settle', () => {
  it('no propaga un rechazo', async () => {
    settle(Promise.reject(new Error('red')));
    settle(null);
    settle(undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(true).toBe(true);
  });
});

describe('asText', () => {
  it('usa fallback ante null, vacío o tipos raros', () => {
    expect(asText(null, 'Comercio')).toBe('Comercio');
    expect(asText(undefined, 'Comercio')).toBe('Comercio');
    expect(asText('  ', 'Comercio')).toBe('Comercio');
    expect(asText('  Ferretería  ', 'Comercio')).toBe('Ferretería');
    expect(asText({ nombre: 'x' }, '')).toBe('');
  });
});

describe('listKey', () => {
  it('nunca devuelve una clave vacía o inválida', () => {
    expect(listKey(undefined, 0, 'msg')).toBe('msg-0');
    expect(listKey(null, 2, 'msg')).toBe('msg-2');
    expect(listKey('', 1, 'fav')).toBe('fav-1');
    expect(listKey('undefined', 3, 'row')).toBe('row-3');
    expect(listKey('abc', 4, 'row')).toBe('abc');
    expect(listKey(12, 0, 'row')).toBe('12');
  });
});

describe('normalizePostImageUrls', () => {
  it('no revienta si la fila de Supabase trae null', () => {
    expect(normalizePostImageUrls(null)).toEqual([]);
    expect(normalizePostImageUrls(undefined)).toEqual([]);
    expect(normalizePostImageUrls([' https://a.test/1.jpg ', '', null])).toEqual([
      'https://a.test/1.jpg',
    ]);
  });
});

describe('isRenderableUri', () => {
  it('rechaza null y acepta esquemas de imagen', () => {
    expect(isRenderableUri(null)).toBe(false);
    expect(isRenderableUri('')).toBe(false);
    expect(isRenderableUri('not a url')).toBe(false);
    expect(isRenderableUri('https://cdn.example/a.jpg')).toBe(true);
    expect(isRenderableUri('file:///tmp/a.jpg')).toBe(true);
  });
});
