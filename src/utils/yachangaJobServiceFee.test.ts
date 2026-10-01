import { describe, expect, it } from 'vitest';
import { calculateYachangaServiceFee } from './yachangaJobServiceFee';

describe('calculateYachangaServiceFee', () => {
  it.each([
    [30_000, 5_000],
    [50_000, 5_000],
    [120_000, 9_200],
    [350_000, 18_500],
    [500_000, 23_000],
    [750_000, 23_000],
  ])('monto %i → costo %i', (amount, fee) => {
    expect(calculateYachangaServiceFee(amount)).toBe(fee);
  });

  it('0 y montos muy bajos devuelven el piso', () => {
    expect(calculateYachangaServiceFee(0)).toBe(5_000);
    expect(calculateYachangaServiceFee(1)).toBe(5_000);
    expect(calculateYachangaServiceFee(49_999)).toBe(5_000);
  });

  it('respeta los bordes de cada tramo', () => {
    expect(calculateYachangaServiceFee(50_001)).toBe(5_001);
    expect(calculateYachangaServiceFee(200_000)).toBe(14_000);
    expect(calculateYachangaServiceFee(200_001)).toBe(14_001);
    expect(calculateYachangaServiceFee(500_001)).toBe(23_000);
  });

  it('rechaza negativos, NaN y valores no numéricos', () => {
    expect(() => calculateYachangaServiceFee(-1)).toThrow(/negativ/);
    expect(() => calculateYachangaServiceFee(-0.01)).toThrow(/negativ/);
    expect(() => calculateYachangaServiceFee(Number.NaN)).toThrow(/numéric/);
    expect(() => calculateYachangaServiceFee(Number.POSITIVE_INFINITY)).toThrow(/numéric/);
    expect(() => calculateYachangaServiceFee('120000' as unknown as number)).toThrow(/numéric/);
  });
});
