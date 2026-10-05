import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCategoriasSortedByPopularidad } from '../data/rubrosCatalog';
import { filterCategoriasForQuery } from '../utils/rubroSearch';

const memory = new Map<string, string>();
const state = vi.hoisted(() => ({
  configured: true,
  table: '',
  selected: '',
  eq: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: async (key: string) => {
      memory.delete(key);
    },
  },
}));

vi.mock('../config/supabase', () => ({
  isSupabaseConfigured: () => state.configured,
}));

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      state.table = table;
      return {
        select: (columns: string) => {
          state.selected = columns;
          return { eq: (...args: unknown[]) => state.eq(...args) };
        },
      };
    },
  }),
}));

import {
  PROFESSIONAL_TRADES_PUBLIC_COLUMNS,
  fallbackTradeCatalog,
  loadTradeCatalog,
  resetTradeCatalogCacheForTests,
  tradesToCatalog,
  type ProfessionalTradeRow,
} from './professionalTradesCatalog';

const ROOT = resolve(__dirname, '../..');

function row(partial: Partial<ProfessionalTradeRow> & Pick<ProfessionalTradeRow, 'id' | 'name'>): ProfessionalTradeRow {
  return {
    slug: partial.slug ?? partial.id,
    category_slug: partial.category_slug ?? null,
    category_name: partial.category_name ?? null,
    sort_order: partial.sort_order ?? 0,
    ...partial,
  };
}

describe('catálogo vivo de oficios', () => {
  beforeEach(() => {
    memory.clear();
    resetTradeCatalogCacheForTests();
    state.configured = true;
    state.table = '';
    state.selected = '';
    state.eq.mockReset();
  });

  it('agrupa por categoría y no deja que un sort_order 0 adelante al grupo', () => {
    const catalog = tradesToCatalog([
      row({
        id: 'z',
        slug: 'zinguería',
        name: 'Zinguería',
        category_slug: null,
        category_name: 'Construcción y oficios',
        sort_order: 0,
      }),
      row({
        id: 'a',
        slug: 'albanileria',
        name: 'Albañilería',
        category_slug: 'construccion-oficios',
        category_name: 'Construcción y oficios',
        sort_order: 2,
      }),
      row({
        id: 'g',
        slug: 'gasista',
        name: 'Gas',
        category_slug: 'construccion-oficios',
        category_name: 'Construcción y oficios',
        sort_order: 2,
      }),
      row({
        id: 'air',
        slug: 'aire-acondicionado-climatizacion',
        name: 'Aire acondicionado y climatización',
        category_slug: 'hogar-mantenimiento',
        category_name: 'Hogar y mantenimiento',
        sort_order: 1,
      }),
    ]);

    const sections = getCategoriasSortedByPopularidad(catalog);
    expect(sections.map((c) => c.nombre)).toEqual([
      'Hogar y mantenimiento',
      'Construcción y oficios',
    ]);
    expect(sections[1]?.slug).toBe('construccion-oficios');
    expect(sections[1]?.servicios.map((s) => s.nombre)).toEqual([
      'Albañilería',
      'Gas',
      'Zinguería',
    ]);
    expect(sections.flatMap((c) => c.servicios).every((s) => s.keywords.length === 0)).toBe(true);

    const gas = filterCategoriasForQuery(sections, 'gas');
    expect(gas.flatMap((s) => s.data.map((item) => item.nombre))).toEqual(['Gas']);
  });

  it('pide solo columnas públicas de oficios activos y las guarda', async () => {
    state.eq.mockResolvedValue({
      data: [
        row({
          id: '1',
          slug: 'gasista',
          name: 'Gas',
          category_slug: 'construccion-oficios',
          category_name: 'Construcción y oficios',
          sort_order: 2,
        }),
      ],
      error: null,
    });

    const first = await loadTradeCatalog();
    expect(state.table).toBe('professional_trades');
    expect(state.selected).toBe(PROFESSIONAL_TRADES_PUBLIC_COLUMNS);
    expect(state.selected).not.toContain('keywords');
    expect(state.selected).not.toContain('search_index');
    expect(state.eq).toHaveBeenCalledWith('active', true);
    expect(first.source).toBe('remote');
    expect(first.catalog.categorias[0]?.servicios[0]?.nombre).toBe('Gas');
    expect(memory.size).toBe(1);

    state.eq.mockRejectedValue(new Error('sin red'));
    resetTradeCatalogCacheForTests();
    const second = await loadTradeCatalog();
    expect(second.source).toBe('cache');
    expect(second.catalog.categorias[0]?.servicios[0]?.nombre).toBe('Gas');
  });

  it('si no hay red ni caché usa rubros.json, con oficios que el admin ya sacó', async () => {
    state.configured = false;
    const result = await loadTradeCatalog();
    expect(result.source).toBe('fallback');
    expect(result.catalog).toBe(fallbackTradeCatalog().catalog);
    const names = result.catalog.categorias.flatMap((c) => c.servicios.map((s) => s.nombre));
    expect(names).toContain('Gasista');
    expect(names).toContain('Soporte técnico informático');
    expect(names).not.toContain('Zinguería');
  });
});

describe('SQL de mapeo de oficios', () => {
  const sql = readFileSync(resolve(ROOT, 'supabase/20261005_card_catalogo_oficios_app.sql'), 'utf8');

  it('documenta el mapa y no toca el catálogo del admin ni los buscadores', () => {
    expect(sql).toContain('Gasista');
    expect(sql).toContain('→ Gas');
    expect(sql).toContain('Mudanzas');
    expect(sql).toContain('Fletes y mudanzas');
    expect(sql).toContain('chr(8209)');
    expect(sql).toContain('professional_trades_select_all');
    expect(sql).toContain('No hace falta un RPC list_active_trades()');
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.list_active_trades/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public\.oficio_keywords/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.professional_trades/i);
    expect(sql).not.toMatch(/search_workers_for_client/);
    expect(sql).not.toMatch(/search_workers_public/);
    expect(sql).toContain('INSERT INTO public.oficio_keywords');
    expect(sql).toContain('UPDATE public.jobs');
    expect(sql).toContain('professional_jobs_backup');
  });

  it('el alta y los selectores leen el catálogo vivo', () => {
    const register = readFileSync(resolve(ROOT, 'src/screens/auth/RegisterScreen.tsx'), 'utf8');
    const picker = readFileSync(resolve(ROOT, 'src/components/search/TradeSearchModal.tsx'), 'utf8');
    const filters = readFileSync(resolve(ROOT, 'src/components/search/RubroMultiSelectModal.tsx'), 'utf8');
    const worker = readFileSync(resolve(ROOT, 'src/screens/account/WorkerABMScreen.tsx'), 'utf8');

    for (const source of [register, picker, filters, worker]) {
      expect(source).not.toContain('rubros.json');
    }
    expect(register).toContain('useTradeCatalog');
    expect(picker).toContain('useTradeCatalog');
    expect(picker).toContain('getCategoriasSortedByPopularidad(catalog)');
    expect(filters).toContain('useTradeCatalog');
    expect(filters).toContain('getCategoriasSortedByPopularidad(catalog)');
    expect(worker).toContain('TradeSearchModal');
  });
});
