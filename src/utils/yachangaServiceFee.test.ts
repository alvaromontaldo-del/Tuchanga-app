import { describe, expect, it } from 'vitest';
import { calculateServiceFee, ceilServiceFeeArs } from './yachangaServiceFee';

describe('ceilServiceFeeArs', () => {
  it('redondea hacia arriba a entero', () => {
    expect(ceilServiceFeeArs(100.01)).toBe(101);
    expect(ceilServiceFeeArs(100)).toBe(100);
    expect(ceilServiceFeeArs(0.1)).toBe(1);
  });
});

describe('calculateServiceFee', () => {
  it('retorna 0 ante montos inválidos', () => {
    for (const bad of [0, -1, NaN, Number.POSITIVE_INFINITY]) {
      const r = calculateServiceFee(bad);
      expect(r.serviceFee).toBe(0);
      expect(r.effectiveRate).toBe(0);
      expect(r.isCapped).toBe(false);
    }
  });

  it('$10.000 → mínimo $5.000 (8% daría $800)', () => {
    const r = calculateServiceFee(10_000);
    expect(r.serviceFee).toBe(5_000);
    expect(r.isMinimumApplied).toBe(true);
    expect(r.effectiveRate).toBe(50);
  });

  it('$62.500 → $5.000 (8% exacto, sin mínimo extra)', () => {
    const r = calculateServiceFee(62_500);
    expect(r.serviceFee).toBe(5_000);
    expect(r.isMinimumApplied).toBe(false);
  });

  it('$100.000 → $8.000 (8.00%), sin tope', () => {
    const r = calculateServiceFee(100_000);
    expect(r.serviceFee).toBe(8_000);
    expect(r.effectiveRate).toBe(8);
    expect(r.isCapped).toBe(false);
    expect(r.breakdown.tier1).toBe(8_000);
    expect(r.breakdown.tier2).toBe(0);
  });

  it('$200.000 → $16.000 (8.00%), sin tope', () => {
    const r = calculateServiceFee(200_000);
    expect(r.serviceFee).toBe(16_000);
    expect(r.effectiveRate).toBe(8);
    expect(r.isCapped).toBe(false);
    expect(r.breakdown.tier1).toBe(16_000);
  });

  it('$200.001 → $16.000 + 6% del excedente (ceil)', () => {
    const r = calculateServiceFee(200_001);
    // 16000 + 0.06*1 = 16000.06 → ceil 16001
    expect(r.serviceFee).toBe(16_001);
    expect(r.isCapped).toBe(false);
  });

  it('$300.000 → $22.000 ($16.000 + $6.000), 7.33%, sin tope', () => {
    const r = calculateServiceFee(300_000);
    expect(r.serviceFee).toBe(22_000);
    expect(r.effectiveRate).toBe(7.33);
    expect(r.isCapped).toBe(false);
    expect(r.breakdown.tier1).toBe(16_000);
    expect(r.breakdown.tier2).toBe(6_000);
  });

  it('$316.667 → tope $23.000', () => {
    const r = calculateServiceFee(316_667);
    expect(r.serviceFee).toBe(23_000);
    expect(r.isCapped).toBe(true);
  });

  it('$316.668 → tope fijo $23.000', () => {
    const r = calculateServiceFee(316_668);
    expect(r.serviceFee).toBe(23_000);
    expect(r.isCapped).toBe(true);
  });

  it('$500.000 → $23.000 (tope fijo)', () => {
    const r = calculateServiceFee(500_000);
    expect(r.serviceFee).toBe(23_000);
    expect(r.effectiveRate).toBe(4.6);
    expect(r.isCapped).toBe(true);
  });

  it('$1.000.000 → $23.000 (2.30% efectivo)', () => {
    const r = calculateServiceFee(1_000_000);
    expect(r.serviceFee).toBe(23_000);
    expect(r.effectiveRate).toBe(2.3);
    expect(r.isCapped).toBe(true);
  });
});
