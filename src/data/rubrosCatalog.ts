import rubrosRoot from './rubros.json';

export type RubroServicio = {
  slug: string;
  nombre: string;
  keywords: string[];
};

export type RubroCategoria = {
  slug: string;
  nombre: string;
  orden_popularidad: number;
  servicios: RubroServicio[];
};

export type RubrosCatalogRoot = {
  version: string;
  idioma: string;
  categorias: RubroCategoria[];
};

export const RUBROS_CATALOG = rubrosRoot as RubrosCatalogRoot;

/** Categorías según popularidad UI (1 = más visible). */
export function getCategoriasSortedByPopularidad(): RubroCategoria[] {
  return [...RUBROS_CATALOG.categorias].sort(
    (a, b) => a.orden_popularidad - b.orden_popularidad,
  );
}

const _allNombresSorted: string[] = (() => {
  const set = new Set<string>();
  for (const c of RUBROS_CATALOG.categorias) {
    for (const s of c.servicios) set.add(s.nombre);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
})();

/** Todos los nombres de rubro, únicos, orden A–Z (filtros, validaciones). */
export const ALL_RUBRO_NOMBRES: readonly string[] = Object.freeze(_allNombresSorted);

export function getDefaultRubroNombre(): string {
  return ALL_RUBRO_NOMBRES[0] ?? '';
}

export function findRubroByNombre(nombre: string): {
  categoria: RubroCategoria;
  servicio: RubroServicio;
} | null {
  const t = nombre.trim();
  if (!t) return null;
  for (const c of RUBROS_CATALOG.categorias) {
    const s = c.servicios.find((x) => x.nombre === t);
    if (s) return { categoria: c, servicio: s };
  }
  return null;
}

export function findRubroBySlug(slug: string): {
  categoria: RubroCategoria;
  servicio: RubroServicio;
} | null {
  const t = slug.trim();
  if (!t) return null;
  for (const c of RUBROS_CATALOG.categorias) {
    const s = c.servicios.find((x) => x.slug === t);
    if (s) return { categoria: c, servicio: s };
  }
  return null;
}
