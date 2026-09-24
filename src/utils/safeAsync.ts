/**
 * Utilidades para que un fallo de red, un id vacío o un null de Supabase
 * no tumben el hilo de JS ni el render.
 */

/** Traga el rechazo de una promesa fire-and-forget. */
export function settle(work: Promise<unknown> | null | undefined): void {
  if (work == null) return;
  const thenable = work as { then?: unknown };
  if (typeof thenable.then !== 'function') return;
  void Promise.resolve(work).catch(() => undefined);
}

/** Texto seguro para pintar UI. Nunca lanza si el valor es null. */
export function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/**
 * keyExtractor que nunca devuelve '', undefined ni 'undefined'.
 * Si el id es válido se usa tal cual (estable al reordenar).
 */
export function listKey(id: unknown, index: number, prefix = 'item'): string {
  let raw = '';
  if (typeof id === 'string') raw = id.trim();
  else if (typeof id === 'number' && Number.isFinite(id)) raw = String(id);
  if (!raw || raw === 'undefined' || raw === 'null') return `${prefix}-${index}`;
  return raw;
}

/** URI que Image / WebView pueden abrir sin tumbar el lado nativo. */
export function isRenderableUri(uri: unknown): uri is string {
  if (typeof uri !== 'string') return false;
  const t = uri.trim();
  if (!t || t === 'null' || t === 'undefined') return false;
  return (
    t.startsWith('https://') ||
    t.startsWith('http://') ||
    t.startsWith('file:') ||
    t.startsWith('content:') ||
    t.startsWith('data:image') ||
    t.startsWith('ph://') ||
    t.startsWith('assets-library:')
  );
}
