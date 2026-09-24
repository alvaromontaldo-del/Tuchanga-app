import { describe, expect, it } from 'vitest';
import { professionalPayoutAmount, workerGivenName } from './contractedWorkDisplay';

describe('workerGivenName', () => {
  it('muestra el nombre completo de pila y no la inicial del apellido', () => {
    expect(workerGivenName('Juan')).toBe('Juan');
    expect(workerGivenName('  Ana María  ')).toBe('Ana María');
  });

  it('usa un fallback si no hay nombre', () => {
    expect(workerGivenName('')).toBe('Profesional');
    expect(workerGivenName(null)).toBe('Profesional');
    expect(workerGivenName('   ')).toBe('Profesional');
  });
});

describe('professionalPayoutAmount', () => {
  it('devuelve solo el pago al profesional, sin el costo de servicio', () => {
    expect(
      professionalPayoutAmount({
        precio_trabajador: 100,
        precio_final: 122,
        comision_app: 22,
      }),
    ).toBe(100);
  });

  it('si falta el neto, resta la comisión al precio final', () => {
    expect(
      professionalPayoutAmount({
        precio_trabajador: 0,
        precio_final: 122,
        comision_app: 22,
      }),
    ).toBe(100);
  });
});
