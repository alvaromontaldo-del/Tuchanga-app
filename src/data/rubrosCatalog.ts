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

/** Catálogo embebido. Solo se usa si no hay red ni caché del catálogo del admin. */
export const RUBROS_CATALOG = rubrosRoot as RubrosCatalogRoot;

/** Categorías según popularidad UI (1 = más visible). */
export function getCategoriasSortedByPopularidad(
  catalog: RubrosCatalogRoot = RUBROS_CATALOG,
): RubroCategoria[] {
  return [...catalog.categorias].sort(
    (a, b) =>
      a.orden_popularidad - b.orden_popularidad ||
      a.nombre.localeCompare(b.nombre, 'es'),
  );
}

const _allNombresSorted: string[] = (() => {
  const set = new Set<string>();
  for (const c of RUBROS_CATALOG.categorias) {
    for (const s of c.servicios) set.add(s.nombre);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
})();

/** Nombres del catálogo embebido, únicos, orden A–Z. El modo demo los sigue usando. */
export const ALL_RUBRO_NOMBRES: readonly string[] = Object.freeze(_allNombresSorted);

export function allRubroNombres(catalog: RubrosCatalogRoot = RUBROS_CATALOG): string[] {
  const set = new Set<string>();
  for (const c of catalog.categorias) {
    for (const s of c.servicios) {
      const nombre = s.nombre.trim();
      if (nombre) set.add(nombre);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

export function getDefaultRubroNombre(catalog: RubrosCatalogRoot = RUBROS_CATALOG): string {
  return allRubroNombres(catalog)[0] ?? '';
}

export function findRubroByNombre(
  nombre: string,
  catalog: RubrosCatalogRoot = RUBROS_CATALOG,
): {
  categoria: RubroCategoria;
  servicio: RubroServicio;
} | null {
  const t = nombre.trim();
  if (!t) return null;
  for (const c of catalog.categorias) {
    const s = c.servicios.find((x) => x.nombre === t);
    if (s) return { categoria: c, servicio: s };
  }
  return null;
}

export function findRubroBySlug(
  slug: string,
  catalog: RubrosCatalogRoot = RUBROS_CATALOG,
): {
  categoria: RubroCategoria;
  servicio: RubroServicio;
} | null {
  const t = slug.trim();
  if (!t) return null;
  for (const c of catalog.categorias) {
    const s = c.servicios.find((x) => x.slug === t);
    if (s) return { categoria: c, servicio: s };
  }
  return null;
}
