/**
 * Reputación pública del profesional.
 *
 * Misma regla que la web: las estrellas, el promedio y las reseñas se muestran
 * solo a partir del 2º trabajo finalizado (`profiles.total_jobs_done >= 2`).
 * Con 0 o 1 trabajo la UI muestra el badge «Nuevo».
 *
 * Contrato de UI (`StarRating`):
 * - `completedJobs` definido y < 2 → badge «Nuevo» (sin estrellas).
 * - `completedJobs` `undefined` (dato ausente: mock o RPC viejo) → estrellas actuales.
 * - `canShowWorkerReputation(null | undefined)` es `false`; el badge no depende de eso
 *   por sí solo: hace falta que el dato esté definido.
 */

export const MIN_COMPLETED_JOBS_FOR_REPUTATION = 2;

/**
 * Entero ≥ 0. `null`, `undefined`, NaN y texto no numérico cuentan como 0.
 * Los decimales se truncan hacia abajo (`2.9` → `2`).
 */
export function normalizeCompletedJobs(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }
  return 0;
}

/** `true` solo con un número finito de trabajos finalizados ≥ 2. */
export function canShowWorkerReputation(completedJobs: number | null | undefined): boolean {
  if (completedJobs == null || !Number.isFinite(completedJobs)) return false;
  return normalizeCompletedJobs(completedJobs) >= MIN_COMPLETED_JOBS_FOR_REPUTATION;
}

/**
 * `undefined` si el campo no vino en el payload.
 * Si la clave existe (aunque sea `null`), devuelve el entero normalizado.
 */
export function completedJobsFromPayload(
  row: object,
  key: string,
): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return undefined;
  return normalizeCompletedJobs((row as Record<string, unknown>)[key]);
}
