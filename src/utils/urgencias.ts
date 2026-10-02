/** Textos de la tarjeta #95. El badge solo existe cuando el flag es true. */

export const ATIENDE_URGENCIAS_TITLE = 'Atiendo urgencias';
export const ATIENDE_URGENCIAS_HINT =
  'Los clientes van a ver que atendés urgencias en cualquier horario.';
export const ATIENDE_URGENCIAS_FILTER = 'Atiende urgencias';
export const URGENCIAS_BADGE_LABEL = 'Urgencias 24 h';

export type UrgenciasBadgeView = {
  label: typeof URGENCIAS_BADGE_LABEL;
  icon: 'flash';
  tone: 'red-orange';
};

/** Lo que pinta la píldora. null = la tarjeta no muestra badge. */
export function urgenciasBadgeView(
  atiende: boolean | null | undefined,
): UrgenciasBadgeView | null {
  if (atiende !== true) return null;
  return { label: URGENCIAS_BADGE_LABEL, icon: 'flash', tone: 'red-orange' };
}

export function readAtiendeUrgencias(value: unknown): boolean {
  return value === true;
}

export function toggleAtiendeUrgencias(current: boolean): boolean {
  return !current;
}

type UrgenciasHit = {
  worker: { atiendeUrgencias?: boolean };
};

/**
 * Con el filtro apagado devuelve el mismo arreglo (mismo orden y distancias).
 * Encendido, deja solo quienes atienden urgencias, en el orden que ya traían.
 */
export function filterSearchHitsByUrgencias<T extends UrgenciasHit>(
  hits: T[],
  onlyUrgencias: boolean,
): T[] {
  if (!onlyUrgencias) return hits;
  return hits.filter((hit) => hit.worker.atiendeUrgencias === true);
}

/** La columna o el RPC todavía no están aplicados en la base. */
export function isMissingUrgenciasSchema(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('atiende_urgencias') ||
    lower.includes('set_my_atiende_urgencias') ||
    (lower.includes('column') && lower.includes('does not exist')) ||
    (lower.includes('function') && lower.includes('does not exist')) ||
    (lower.includes('schema cache') && lower.includes('atiende'))
  );
}
