import { describe, expect, it } from 'vitest';
import { coarseCoord } from './publicWorkerSearch';

describe('coarseCoord', () => {
  it('redondea a 2 decimales para un pin aproximado', () => {
    expect(coarseCoord(-34.60372)).toBe(-34.6);
    expect(coarseCoord(-58.38159)).toBe(-58.38);
    expect(coarseCoord(Number.NaN)).toBeNaN();
  });
});
