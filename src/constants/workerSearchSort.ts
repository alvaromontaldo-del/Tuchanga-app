export const WORKER_SEARCH_SORTS = [
  { id: 'score', label: 'Recomendados' },
  { id: 'rating', label: 'Mejor valorados' },
  { id: 'jobs', label: 'Más contratados' },
  { id: 'distance', label: 'Más cercanos' },
] as const;

export type WorkerSearchSort = (typeof WORKER_SEARCH_SORTS)[number]['id'];
