import { describe, expect, it } from 'vitest';
import {
  assertWarrantyDays,
  parseWarrantyDaysInput,
  quoteWarrantyLabel,
  warrantyAnchorIso,
  warrantyCountdown,
  warrantyCountdownLabel,
  warrantyDaysError,
} from './warrantyDays';

const DAY = 24 * 60 * 60 * 1000;
const anchor = '2026-09-01T12:00:00.000Z';

describe('warrantyDaysError', () => {
  it('no exige días si el check está apagado', () => {
    expect(warrantyDaysError(false, null)).toBeNull();
    expect(warrantyDaysError(false, 99)).toBeNull();
  });

  it('exige un entero de 1 a 60 si incluye garantía', () => {
    expect(warrantyDaysError(true, null)).toMatch(/1 a 60/);
    expect(warrantyDaysError(true, 0)).toMatch(/1 a 60/);
    expect(warrantyDaysError(true, 61)).toMatch(/1 a 60/);
    expect(warrantyDaysError(true, 1)).toBeNull();
    expect(warrantyDaysError(true, 60)).toBeNull();
  });
});

describe('parseWarrantyDaysInput', () => {
  it('lee solo dígitos', () => {
    expect(parseWarrantyDaysInput('')).toBeNull();
    expect(parseWarrantyDaysInput('15')).toBe(15);
    expect(parseWarrantyDaysInput('15 días')).toBe(15);
  });
});

describe('assertWarrantyDays', () => {
  it('acepta null y el rango 1–60', () => {
    expect(assertWarrantyDays(null)).toBeNull();
    expect(assertWarrantyDays(undefined)).toBeNull();
    expect(assertWarrantyDays(30)).toBe(30);
  });

  it('rechaza valores fuera de rango', () => {
    expect(() => assertWarrantyDays(0)).toThrow(/1 a 60/);
    expect(() => assertWarrantyDays(365)).toThrow(/1 a 60/);
  });
});

describe('warrantyCountdown', () => {
  it('sin días no muestra garantía', () => {
    expect(warrantyCountdown({ warrantyDays: null, anchorAt: anchor }).status).toBe('none');
    expect(quoteWarrantyLabel(null)).toBe('Sin garantía');
  });

  it('antes de finalizar muestra el total pactado', () => {
    const state = warrantyCountdown({ warrantyDays: 15, anchorAt: null });
    expect(state).toEqual({ status: 'pending', totalDays: 15 });
    expect(warrantyCountdownLabel(state)).toBe('Incluye garantía: 15 días');
    expect(quoteWarrantyLabel(1)).toBe('Incluye garantía: 1 día');
  });

  it('descuenta días corridos desde el ancla de finalización', () => {
    const start = new Date(anchor);
    expect(
      warrantyCountdown({ warrantyDays: 30, anchorAt: anchor, now: start }),
    ).toEqual({ status: 'active', totalDays: 30, remainingDays: 30 });

    expect(
      warrantyCountdown({
        warrantyDays: 30,
        anchorAt: anchor,
        now: new Date(start.getTime() + DAY),
      }),
    ).toEqual({ status: 'active', totalDays: 30, remainingDays: 29 });

    const lastHour = new Date(start.getTime() + 29 * DAY + 23 * 60 * 60 * 1000);
    const last = warrantyCountdown({ warrantyDays: 30, anchorAt: anchor, now: lastHour });
    expect(last.status).toBe('active');
    expect(warrantyCountdownLabel(last)).toBe('Garantía: queda 1 día');

    const ended = new Date(start.getTime() + 30 * DAY);
    const expired = warrantyCountdown({ warrantyDays: 30, anchorAt: anchor, now: ended });
    expect(expired.status).toBe('expired');
    expect(warrantyCountdownLabel(expired)).toBe('Garantía vencida');
  });

  it('usa finalizado_at solo cuando el trabajo ya está finalizado', () => {
    expect(
      warrantyAnchorIso({
        estadoTrabajo: 'en_curso',
        finalizadoAt: anchor,
      }),
    ).toBeNull();
    expect(
      warrantyAnchorIso({
        estadoTrabajo: 'finalizado',
        warrantyAnchorAt: null,
        finalizadoAt: anchor,
      }),
    ).toBe(anchor);
    expect(
      warrantyAnchorIso({
        estadoTrabajo: 'finalizado',
        warrantyAnchorAt: '2026-09-02T00:00:00.000Z',
        finalizadoAt: anchor,
      }),
    ).toBe('2026-09-02T00:00:00.000Z');
  });
});
