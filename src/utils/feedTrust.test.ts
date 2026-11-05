import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { feedHomeShowsNuevo, feedPublicationLine, feedTrustIcons } from './feedTrust';

describe('reputación del feed de inicio', () => {
  it('con menos de 2 trabajos muestra Nuevo y no el puntaje', () => {
    expect(feedHomeShowsNuevo(0)).toBe(true);
    expect(feedHomeShowsNuevo(1)).toBe(true);
  });

  it('desde 2 trabajos muestra la estrella y el puntaje', () => {
    expect(feedHomeShowsNuevo(2)).toBe(false);
    expect(feedHomeShowsNuevo(6)).toBe(false);
    expect(feedPublicationLine('Horacio', 4.3, 6)).toBe('Horacio ★ 4.3 (6)');
  });

  it('sin el dato de trabajos no inventa el badge Nuevo', () => {
    expect(feedHomeShowsNuevo(undefined)).toBe(false);
  });

  it('los íconos no dependen de la reputación', () => {
    expect(feedTrustIcons(true, ['gas'])).toEqual(['antecedentes', 'gas']);
  });

  it('la publicación de inicio usa Nuevo y deja el puntaje oculto', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/feed/ChangaImagePost.tsx'),
      'utf8',
    );
    expect(source).toContain('feedHomeShowsNuevo');
    expect(source).toContain('StarRating');
    expect(source).toContain('showScore={!showNuevo}');
    expect(source).toContain('professionalDisplayNameForClient');
  });
});
