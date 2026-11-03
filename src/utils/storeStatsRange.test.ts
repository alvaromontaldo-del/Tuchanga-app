import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreStats } from '../services/storeStats';
import { storeStatsRange, validateCustomRange } from './storeStatsRange';

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => {
    throw new Error('unused');
  },
}));

describe('storeStatsRange', () => {
  it('hoy cerca de medianoche UTC es el día anterior en Argentina', () => {
    const now = new Date('2026-11-04T01:30:00.000Z');
    expect(storeStatsRange('today', now)).toEqual({
      from: '2026-11-03',
      to: '2026-11-03',
    });
  });

  it('la semana va de lunes a hoy', () => {
    const monday = new Date('2026-11-02T15:00:00.000Z');
    expect(storeStatsRange('week', monday)).toEqual({
      from: '2026-11-02',
      to: '2026-11-02',
    });

    const sundayNearUtcMidnight = new Date('2026-11-09T01:30:00.000Z');
    expect(storeStatsRange('week', sundayNearUtcMidnight)).toEqual({
      from: '2026-11-02',
      to: '2026-11-08',
    });
  });

  it('el mes el día 1 arranca ese mismo día', () => {
    const first = new Date('2026-11-01T15:00:00.000Z');
    expect(storeStatsRange('month', first)).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
    });
  });

  it('rechaza un rango invertido o mayor a 366 días', () => {
    const now = new Date('2026-11-03T15:00:00.000Z');
    expect(validateCustomRange('2026-11-03', '2026-11-01', now)).toBe('invalid_range');
    expect(() =>
      storeStatsRange('custom', now, { from: '2026-11-03', to: '2026-11-01' }),
    ).toThrow('invalid_range');

    expect(validateCustomRange('2025-01-01', '2026-01-02', now)).toBeNull();
    expect(validateCustomRange('2025-01-01', '2026-01-03', now)).toBe('range_too_long');
    expect(() =>
      storeStatsRange('custom', now, { from: '2025-01-01', to: '2026-01-03' }),
    ).toThrow('range_too_long');
  });

  it('rechaza fechas futuras en Argentina', () => {
    const now = new Date('2026-11-04T01:30:00.000Z');
    expect(validateCustomRange('2026-11-03', '2026-11-04', now)).toBe('future');
    expect(validateCustomRange('2026-11-03', '2026-11-03', now)).toBeNull();
  });
});

describe('normalizeStoreStats', () => {
  it('convierte los números que llegan como string', () => {
    const stats = normalizeStoreStats({
      from: '2026-11-01',
      to: '2026-11-03',
      has_store: true,
      earnings: '150000.4',
      sales_count: '3',
      avg_ticket: '50000',
      quotes_sent: '8',
      quotes_closed: '3',
      close_rate: '37.5',
      top_materials: [
        { description: 'Cemento', unit: 'bolsa', quantity: '12.5', sales: '2' },
      ],
    });

    expect(stats.earnings).toBe(150000.4);
    expect(stats.sales_count).toBe(3);
    expect(stats.avg_ticket).toBe(50000);
    expect(stats.quotes_sent).toBe(8);
    expect(stats.quotes_closed).toBe(3);
    expect(stats.close_rate).toBe(37.5);
    expect(stats.top_materials).toEqual([
      { description: 'Cemento', unit: 'bolsa', quantity: 12.5, sales: 2 },
    ]);
  });

  it('conserva close_rate null y acepta el JSON como string', () => {
    const stats = normalizeStoreStats(
      JSON.stringify({
        from: '2026-11-03',
        to: '2026-11-03',
        has_store: 'false',
        earnings: '0',
        sales_count: 0,
        avg_ticket: 0,
        quotes_sent: 0,
        quotes_closed: 0,
        close_rate: null,
        top_materials: '[]',
      }),
    );

    expect(stats.has_store).toBe(false);
    expect(stats.close_rate).toBeNull();
    expect(stats.top_materials).toEqual([]);
    expect(stats.earnings).toBe(0);
  });
});
