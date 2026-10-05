import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured } from '../config/supabase';
import type { RubroCategoria, RubrosCatalogRoot, RubroServicio } from '../data/rubrosCatalog';
import { RUBROS_CATALOG } from '../data/rubrosCatalog';
import { getSupabaseClient } from '../lib/supabase';

/**
 * Columnas públicas del catálogo. `keywords` y `search_index` quedan en el admin
 * y en el buscador (#97); el selector de la app no los necesita.
 */
export const PROFESSIONAL_TRADES_PUBLIC_COLUMNS =
  'id,slug,name,category_slug,category_name,sort_order';

const CACHE_KEY = 'tu-changa:professional-trades:v1';

export type ProfessionalTradeRow = {
  id: string;
  slug: string;
  name: string;
  category_slug: string | null;
  category_name: string | null;
  sort_order: number | null;
};

export type TradeCatalogSource = 'remote' | 'cache' | 'fallback';

export type TradeCatalogResult = {
  source: TradeCatalogSource;
  catalog: RubrosCatalogRoot;
  savedAt: string | null;
};

type StoredCatalog = {
  v: 1;
  savedAt: string;
  rows: ProfessionalTradeRow[];
};

type MemoryCatalog = {
  source: 'remote';
  catalog: RubrosCatalogRoot;
  savedAt: string;
  rows: ProfessionalTradeRow[];
};

let memory: MemoryCatalog | null = null;
let inflight: Promise<TradeCatalogResult> | null = null;

export function resetTradeCatalogCacheForTests(): void {
  memory = null;
  inflight = null;
}

export function peekRemoteTradeCatalog(): TradeCatalogResult | null {
  if (!memory) return null;
  return { source: 'remote', catalog: memory.catalog, savedAt: memory.savedAt };
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeTradeRows(data: unknown): ProfessionalTradeRow[] {
  if (!Array.isArray(data)) return [];
  const out: ProfessionalTradeRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const name = asText(row.name);
    const id = asText(row.id);
    if (!name || !id) continue;
    const sort = Number(row.sort_order);
    out.push({
      id,
      slug: asText(row.slug),
      name,
      category_slug: asText(row.category_slug) || null,
      category_name: asText(row.category_name) || null,
      sort_order: Number.isFinite(sort) ? sort : 0,
    });
  }
  return out;
}

/**
 * Arma el mismo agrupado que `rubros.json`: una sección por categoría,
 * ordenada por `sort_order` (el 0 de oficios nuevos no adelanta al grupo).
 * Las palabras clave no viajan: el selector busca por nombre y categoría.
 */
export function tradesToCatalog(rows: ProfessionalTradeRow[]): RubrosCatalogRoot {
  const groups = new Map<
    string,
    { slug: string; nombre: string; orden: number; servicios: RubroServicio[] }
  >();

  for (const row of rows) {
    const nombre = row.name.trim();
    if (!nombre) continue;
    const catName = row.category_name?.trim() || 'Otros';
    let group = groups.get(catName);
    if (!group) {
      group = {
        slug: row.category_slug?.trim() || slugify(catName) || 'otros',
        nombre: catName,
        orden: 999,
        servicios: [],
      };
      groups.set(catName, group);
    }
    if (row.category_slug?.trim()) group.slug = row.category_slug.trim();
    const order = row.sort_order ?? 0;
    if (order > 0 && order < group.orden) group.orden = order;
    group.servicios.push({
      slug: row.slug.trim() || slugify(nombre) || row.id,
      nombre,
      keywords: [],
    });
  }

  const categorias: RubroCategoria[] = [...groups.values()]
    .map((group) => ({
      slug: group.slug,
      nombre: group.nombre,
      orden_popularidad: group.orden,
      servicios: [...group.servicios].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    }))
    .sort(
      (a, b) =>
        a.orden_popularidad - b.orden_popularidad || a.nombre.localeCompare(b.nombre, 'es'),
    );

  return { version: 'professional_trades', idioma: 'es-AR', categorias };
}

export function fallbackTradeCatalog(): TradeCatalogResult {
  return { source: 'fallback', catalog: RUBROS_CATALOG, savedAt: null };
}

export async function fetchActiveProfessionalTrades(): Promise<ProfessionalTradeRow[]> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase no está configurado.');
  }
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('professional_trades')
    .select(PROFESSIONAL_TRADES_PUBLIC_COLUMNS)
    .eq('active', true);
  if (error) {
    throw new Error(error.message || 'No se pudo leer el catálogo de oficios.');
  }
  return normalizeTradeRows(data);
}

async function writeStoredRows(rows: ProfessionalTradeRow[], savedAt: string): Promise<void> {
  const payload: StoredCatalog = { v: 1, savedAt, rows };
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* sin almacenamiento igual podemos usar la lista de esta sesión */
  }
}

export async function readStoredTradeCatalog(): Promise<TradeCatalogResult | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCatalog>;
    if (parsed?.v !== 1) return null;
    const rows = normalizeTradeRows(parsed.rows);
    if (rows.length === 0) return null;
    const savedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : null;
    return { source: 'cache', catalog: tradesToCatalog(rows), savedAt };
  } catch {
    return null;
  }
}

async function resolveTradeCatalog(): Promise<TradeCatalogResult> {
  if (memory) {
    return { source: 'remote', catalog: memory.catalog, savedAt: memory.savedAt };
  }
  try {
    const rows = await fetchActiveProfessionalTrades();
    const savedAt = new Date().toISOString();
    const catalog = tradesToCatalog(rows);
    memory = { source: 'remote', catalog, savedAt, rows };
    await writeStoredRows(rows, savedAt);
    return { source: 'remote', catalog, savedAt };
  } catch {
    const stored = await readStoredTradeCatalog();
    if (stored) return stored;
    return fallbackTradeCatalog();
  }
}

/**
 * Catálogo activo del admin. Si esta sesión ya lo bajó, lo reutiliza.
 * Si la red falla: última lista guardada en el teléfono y, si no hay, `rubros.json`.
 */
export function loadTradeCatalog(): Promise<TradeCatalogResult> {
  if (memory) {
    return Promise.resolve({
      source: 'remote',
      catalog: memory.catalog,
      savedAt: memory.savedAt,
    });
  }
  if (!inflight) {
    inflight = resolveTradeCatalog().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
