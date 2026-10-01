import { describe, expect, it } from 'vitest';
import { coarseCoord, lastNameInitial, publicWorkerLabel } from './publicWorkerSearch';

describe('publicWorkerLabel', () => {
  it('muestra el nombre y solo la inicial del apellido', () => {
    expect(publicWorkerLabel('María', 'García')).toBe('María G.');
    expect(publicWorkerLabel('María', 'G')).toBe('María G.');
    expect(publicWorkerLabel('María', 'g.')).toBe('María G.');
    expect(publicWorkerLabel('Ana María', 'álvarez')).toBe('Ana María Á.');
  });

  it('no inventa una inicial si no hay apellido', () => {
    expect(publicWorkerLabel('Lucas', '')).toBe('Lucas');
    expect(publicWorkerLabel('Lucas', null)).toBe('Lucas');
    expect(publicWorkerLabel('  ', null)).toBe('Profesional');
    expect(lastNameInitial('   ')).toBe('');
  });
});

describe('coarseCoord', () => {
  it('redondea a 2 decimales para un pin aproximado', () => {
    expect(coarseCoord(-34.60372)).toBe(-34.6);
    expect(coarseCoord(-58.38159)).toBe(-58.38);
    expect(coarseCoord(Number.NaN)).toBeNaN();
  });
});
