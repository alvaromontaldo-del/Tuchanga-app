import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEARCH_PLACEHOLDER,
  SEARCH_PLACEHOLDER_EM,
  SEARCH_PLACEHOLDER_MIN_FONT,
  searchPlaceholderFontSize,
  searchPlaceholderSlotWidth,
} from './searchPlaceholder';

describe('placeholder de búsqueda de oficios', () => {
  it('muestra la frase completa, sin puntos suspensivos', () => {
    expect(SEARCH_PLACEHOLDER).toBe('Buscar profesionales u oficios');
    expect(SEARCH_PLACEHOLDER.endsWith('…')).toBe(false);
    expect(SEARCH_PLACEHOLDER.includes('...')).toBe(false);
  });

  it('entra entero al lado de Filtros en teléfonos chicos y grandes', () => {
    const screens = [320, 360, 375, 390, 412, 430];
    for (const screen of screens) {
      const slot = searchPlaceholderSlotWidth(screen);
      const size = searchPlaceholderFontSize(slot);
      expect(size).toBeGreaterThanOrEqual(SEARCH_PLACEHOLDER_MIN_FONT);
      expect(size * SEARCH_PLACEHOLDER_EM).toBeLessThanOrEqual(slot);
    }
  });

  it('en un teléfono de ~390 pt no se queda en el mínimo', () => {
    const size = searchPlaceholderFontSize(searchPlaceholderSlotWidth(390));
    expect(size).toBeGreaterThanOrEqual(14);
    expect(size).toBeLessThanOrEqual(15);
  });

  it('la barra no usa el placeholder nativo que se corta con puntos suspensivos', () => {
    const src = readFileSync(resolve(__dirname, '../components/search/SearchHeaderBar.tsx'), 'utf8');
    expect(src).toContain('SEARCH_PLACEHOLDER');
    expect(src).toContain('adjustsFontSizeToFit');
    expect(src).toContain('placeholder=""');
    expect(src).not.toContain('Buscar profesionales u oficios…');
  });
});
