import { describe, expect, it } from 'vitest';
import {
  MIN_COMPLETED_JOBS_FOR_REPUTATION,
  canShowWorkerReputation,
  completedJobsFromPayload,
  normalizeCompletedJobs,
} from './workerReputation';

/**
 * Contrato de UI: si `completedJobs` está definido y es < 2 → badge «Nuevo».
 * Si es `undefined`, StarRating mantiene las estrellas (legacy / mock sin el campo).
 * `canShowWorkerReputation(null | undefined)` es false; no alcanza para el badge
 * sin un dato definido.
 */
describe('canShowWorkerReputation', () => {
  it('oculta reputación con 0 o 1 trabajo finalizado', () => {
    expect(canShowWorkerReputation(0)).toBe(false);
    expect(canShowWorkerReputation(1)).toBe(false);
  });

  it('muestra reputación desde el 2º trabajo', () => {
    expect(MIN_COMPLETED_JOBS_FOR_REPUTATION).toBe(2);
    expect(canShowWorkerReputation(2)).toBe(true);
    expect(canShowWorkerReputation(5)).toBe(true);
  });

  it('null y undefined no habilitan reputación', () => {
    expect(canShowWorkerReputation(null)).toBe(false);
    expect(canShowWorkerReputation(undefined)).toBe(false);
  });

  it('trunca decimales antes de comparar el umbral', () => {
    expect(canShowWorkerReputation(1.9)).toBe(false);
    expect(canShowWorkerReputation(2.2)).toBe(true);
  });
});

describe('normalizeCompletedJobs', () => {
  it('normaliza ausentes, negativos y basura a 0', () => {
    expect(normalizeCompletedJobs(null)).toBe(0);
    expect(normalizeCompletedJobs(undefined)).toBe(0);
    expect(normalizeCompletedJobs('')).toBe(0);
    expect(normalizeCompletedJobs('no')).toBe(0);
    expect(normalizeCompletedJobs(Number.NaN)).toBe(0);
    expect(normalizeCompletedJobs(-4)).toBe(0);
  });

  it('trunca hacia abajo y acepta strings numéricos', () => {
    expect(normalizeCompletedJobs(0)).toBe(0);
    expect(normalizeCompletedJobs(1)).toBe(1);
    expect(normalizeCompletedJobs(2.9)).toBe(2);
    expect(normalizeCompletedJobs('5')).toBe(5);
    expect(normalizeCompletedJobs(' 3 ')).toBe(3);
  });
});

describe('completedJobsFromPayload', () => {
  it('distingue clave ausente de cero real', () => {
    expect(completedJobsFromPayload({}, 'total_jobs_done')).toBeUndefined();
    expect(completedJobsFromPayload({ total_jobs_done: 0 }, 'total_jobs_done')).toBe(0);
    expect(completedJobsFromPayload({ total_jobs_done: null }, 'total_jobs_done')).toBe(0);
    expect(completedJobsFromPayload({ total_jobs_done: 1 }, 'worker_total_jobs_done')).toBeUndefined();
    expect(completedJobsFromPayload({ worker_total_jobs_done: 4 }, 'worker_total_jobs_done')).toBe(4);
  });
});
