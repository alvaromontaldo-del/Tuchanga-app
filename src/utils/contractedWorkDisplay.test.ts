import { describe, expect, it } from 'vitest';
import { warrantyCountdown } from './warrantyDays';
import {
  contractedWarrantyDurationLabel,
  contractedWorkMoneyDisplay,
  professionalPayoutAmount,
  workerGivenName,
  yachangaServiceFeeAmount,
} from './contractedWorkDisplay';

describe('workerGivenName', () => {
  it('muestra el nombre de pila y no la inicial del apellido', () => {
    expect(workerGivenName('Juan')).toBe('Juan');
    expect(workerGivenName('Alvaro')).toBe('Alvaro');
    expect(workerGivenName('Alvaro M.')).toBe('Alvaro');
    expect(workerGivenName('Alvaro M')).toBe('Alvaro');
    expect(workerGivenName('  Ana María  ')).toBe('Ana María');
  });

  it('usa un fallback si no hay nombre', () => {
    expect(workerGivenName('')).toBe('Profesional');
    expect(workerGivenName(null)).toBe('Profesional');
    expect(workerGivenName('   ')).toBe('Profesional');
  });
});

describe('contractedWorkMoneyDisplay', () => {
  it('separa el pago al profesional del costo de servicio YaChanga', () => {
    const row = {
      precio_trabajador: 2300,
      precio_final: 2806,
      comision_app: 506,
    };
    expect(professionalPayoutAmount(row)).toBe(2300);
    expect(yachangaServiceFeeAmount(row)).toBe(506);
    const display = contractedWorkMoneyDisplay(row);
    expect(display).toEqual({
      professionalLabel: 'Pago al profesional',
      professionalAmount: '$2.300',
      serviceFeeLabel: 'Costo de servicio YaChanga',
      serviceFeeAmount: '$506',
    });
    expect(`${display.professionalAmount} ${display.serviceFeeAmount}`).not.toContain('2.806');
  });

  it('si falta el neto, resta la comisión al precio final', () => {
    const row = {
      precio_trabajador: 0,
      precio_final: 2806,
      comision_app: 506,
    };
    expect(professionalPayoutAmount(row)).toBe(2300);
    expect(yachangaServiceFeeAmount(row)).toBe(506);
  });

  it('si falta la comisión guardada, usa la diferencia con el total', () => {
    expect(
      yachangaServiceFeeAmount({
        precio_trabajador: 2300,
        precio_final: 2806,
        comision_app: 0,
      }),
    ).toBe(506);
  });
});

describe('contractedWarrantyDurationLabel', () => {
  const anchor = '2026-09-01T12:00:00.000Z';
  const day = 24 * 60 * 60 * 1000;

  it('muestra solo días, sin horas ni minutos', () => {
    const pending = warrantyCountdown({ warrantyDays: 24, anchorAt: null });
    expect(contractedWarrantyDurationLabel(pending)).toBe('24d');

    const start = new Date(anchor);
    const active = warrantyCountdown({
      warrantyDays: 30,
      anchorAt: anchor,
      now: new Date(start.getTime() + 6 * day + 23 * 60 * 60 * 1000 + 44 * 60 * 1000),
    });
    expect(contractedWarrantyDurationLabel(active)).toBe('24d');
    expect(contractedWarrantyDurationLabel(active)).not.toMatch(/h|m|hora|minuto/i);
  });

  it('al vencer queda en 0d y sin garantía no muestra nada', () => {
    const start = new Date(anchor);
    const expired = warrantyCountdown({
      warrantyDays: 30,
      anchorAt: anchor,
      now: new Date(start.getTime() + 30 * day),
    });
    expect(contractedWarrantyDurationLabel(expired)).toBe('0d');
    expect(
      contractedWarrantyDurationLabel(warrantyCountdown({ warrantyDays: null, anchorAt: anchor })),
    ).toBeNull();
  });
});
