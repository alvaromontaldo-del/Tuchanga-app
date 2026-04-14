import { ALL_RUBRO_NOMBRES, findRubroByNombre } from './rubrosCatalog';
import { foldAccents } from '../utils/normalizeSearch';
import { haversineDistanceKm } from '../utils/geoDistance';
import { rubroBlobMatchesQuery } from '../utils/rubroSearch';

/**
 * Profesionales indexados para búsqueda (mock).
 * En producción: API con PostGIS (ubicación + coverage_km del perfil) y filtros por rubro/texto.
 */

export type SearchableWorker = {
  id: string;
  firstName: string;
  /** Línea corta para la lista */
  summary: string;
  ratingAverage: number;
  reviewCount: number;
  avatarUrl: string;
  /** Rubros canónicos (nombres del catálogo `rubros.json`) */
  categories: string[];
  /** Ubicación base del trabajador (misma idea que `profiles.location`). */
  lat: number;
  lng: number;
  /** Radio en km: solo aparece si el cliente está a ≤ esta distancia. */
  coverageKm: number;
};

export type SearchWorkerHit = {
  worker: SearchableWorker;
  /** Distancia cliente → trabajador (km). */
  distanceKm: number;
};

export { ALL_RUBRO_NOMBRES };

/** @deprecated Usá ALL_RUBRO_NOMBRES; se mantiene para imports legacy. */
export const JOB_CATEGORIES = ALL_RUBRO_NOMBRES;

/** Coordenadas aproximadas para mock (AMBA y cercanías). */
export const SEARCH_WORKERS: SearchableWorker[] = [
  {
    id: 'w1',
    firstName: 'María',
    summary: 'Electricista matriculada · Albañilería ligera · Paseos con mascotas',
    ratingAverage: 4.7,
    reviewCount: 8,
    avatarUrl: 'https://i.pravatar.cc/150?img=5',
    categories: ['Electricidad', 'Albañilería', 'Paseo de perros'],
    lat: -34.6037,
    lng: -58.3816,
    coverageKm: 12,
  },
  {
    id: 'w2',
    firstName: 'Lucas',
    summary: 'Plomería, destapaciones y gas en cocina y baño',
    ratingAverage: 4.5,
    reviewCount: 6,
    avatarUrl: 'https://i.pravatar.cc/150?img=12',
    categories: ['Plomería', 'Gasista'],
    lat: -34.6158,
    lng: -58.4333,
    coverageKm: 18,
  },
  {
    id: 'w3',
    firstName: 'Ana',
    summary: 'Paseos individuales y grupales · Cuidado en domicilio',
    ratingAverage: 5,
    reviewCount: 5,
    avatarUrl: 'https://i.pravatar.cc/150?img=9',
    categories: ['Paseo de perros'],
    lat: -34.5895,
    lng: -58.3974,
    coverageKm: 8,
  },
  {
    id: 'w4',
    firstName: 'Roberto',
    summary: 'Gasista matriculado · Revisión de artefactos y instalaciones',
    ratingAverage: 4.7,
    reviewCount: 3,
    avatarUrl: 'https://i.pravatar.cc/150?img=33',
    categories: ['Gasista', 'Plomería'],
    lat: -34.404,
    lng: -58.596,
    coverageKm: 25,
  },
  {
    id: 'w5',
    firstName: 'Carolina',
    summary: 'Pintura interior y exterior · Pequeñas reparaciones',
    ratingAverage: 4.5,
    reviewCount: 2,
    avatarUrl: 'https://i.pravatar.cc/150?img=47',
    categories: ['Pintura (obras)', 'Albañilería'],
    lat: -34.9214,
    lng: -57.9544,
    coverageKm: 35,
  },
  {
    id: 'w6',
    firstName: 'Diego',
    summary: 'Instalaciones eléctricas y tableros en obra y hogar',
    ratingAverage: 4.5,
    reviewCount: 2,
    avatarUrl: 'https://i.pravatar.cc/150?img=15',
    categories: ['Electricidad'],
    lat: -38.0055,
    lng: -57.5426,
    coverageKm: 22,
  },
];

function workerSearchBlob(worker: SearchableWorker): string {
  const parts: string[] = [worker.firstName, worker.summary, ...worker.categories];
  for (const cat of worker.categories) {
    const hit = findRubroByNombre(cat);
    if (hit) {
      parts.push(hit.categoria.nombre, ...hit.servicio.keywords);
    }
  }
  return parts.join(' ');
}

/**
 * Resultados ordenados por distancia. Sin ubicación del cliente → lista vacía.
 * Filtro geográfico: distancia(cliente, trabajador) ≤ `worker.coverageKm`.
 */
export function searchWorkerHits(
  workers: SearchableWorker[],
  query: string,
  selectedCategories: string[],
  clientPosition: { lat: number; lng: number } | null,
): SearchWorkerHit[] {
  if (!clientPosition) return [];

  const qRaw = query.trim();
  const qFold = foldAccents(qRaw);

  const hits: SearchWorkerHit[] = [];

  for (const w of workers) {
    const distanceKm = haversineDistanceKm(
      clientPosition.lat,
      clientPosition.lng,
      w.lat,
      w.lng,
    );
    if (distanceKm > w.coverageKm) continue;

    if (selectedCategories.length > 0) {
      const matchCat = w.categories.some((c) => selectedCategories.includes(c));
      if (!matchCat) continue;
    }

    if (qFold) {
      const blob = foldAccents(workerSearchBlob(w).toLowerCase());
      if (!rubroBlobMatchesQuery(blob, qRaw)) continue;
    }

    hits.push({ worker: w, distanceKm });
  }

  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  return hits;
}
