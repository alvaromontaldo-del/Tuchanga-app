import type { RubroCategoria, RubroServicio } from '../data/rubrosCatalog';
import { foldAccents } from './normalizeSearch';

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

function wordsFromFoldedBlob(blob: string): string[] {
  return blob.split(/[^a-z0-9ñ]+/i).filter((w) => w.length > 0);
}

/**
 * Coincidencia tolerante: frase completa, tokens, y distancia corta en palabras (fuzzy ligero).
 */
export function rubroBlobMatchesQuery(blobFolded: string, queryRaw: string): boolean {
  const q = foldAccents(queryRaw.trim());
  if (!q) return true;
  if (blobFolded.includes(q)) return true;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const blobWords = wordsFromFoldedBlob(blobFolded);
  return tokens.every((token) => {
    if (blobFolded.includes(token)) return true;
    if (token.length <= 2) return blobWords.some((w) => w === token || w.startsWith(token));
    const maxDist = token.length <= 4 ? 1 : 2;
    return blobWords.some((w) => {
      if (w.includes(token) || token.includes(w)) return true;
      if (Math.abs(w.length - token.length) > maxDist) return false;
      return levenshtein(token, w) <= maxDist;
    });
  });
}

export function buildRubroSearchBlob(servicio: RubroServicio, categoriaNombre: string): string {
  return foldAccents(
    [servicio.nombre, ...servicio.keywords, categoriaNombre].join(' ').toLowerCase(),
  );
}

export function servicioMatchesRubroQuery(
  servicio: RubroServicio,
  categoriaNombre: string,
  query: string,
): boolean {
  const blob = buildRubroSearchBlob(servicio, categoriaNombre);
  return rubroBlobMatchesQuery(blob, query);
}

export function filterCategoriasForQuery(
  categorias: RubroCategoria[],
  query: string,
): { title: string; data: RubroServicio[] }[] {
  const q = query.trim();
  const out: { title: string; data: RubroServicio[] }[] = [];
  for (const c of categorias) {
    const data = q
      ? c.servicios.filter((s) => servicioMatchesRubroQuery(s, c.nombre, q))
      : [...c.servicios];
    if (data.length > 0) out.push({ title: c.nombre, data });
  }
  return out;
}
