import { describe, expect, it } from 'vitest';
import { professionalDescriptionColumns, resolveAccountBio } from './professionalDescription';

describe('descripción profesional del alta', () => {
  it('prefiere professional_description y si no, la bio', () => {
    expect(
      resolveAccountBio({
        professionalDescription: '  Arreglo caños  ',
        bio: 'otra',
        tradeFallback: 'oficio',
      }),
    ).toBe('Arreglo caños');
    expect(resolveAccountBio({ professionalDescription: '', bio: '  Desde la bio  ' })).toBe(
      'Desde la bio',
    );
    expect(resolveAccountBio({ bio: '', tradeFallback: 'Plomero: pérdidas' })).toBe(
      'Plomero: pérdidas',
    );
    expect(resolveAccountBio({ bio: '   ', professionalDescription: null })).toBeUndefined();
  });

  it('escribe las dos columnas con el mismo texto', () => {
    expect(professionalDescriptionColumns('  Hola, soy Ana.  ')).toEqual({
      professional_description: 'Hola, soy Ana.',
      bio: 'Hola, soy Ana.',
    });
  });
});
