import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { joinSpanishAnd, summarizeRejectedMaterials } from './rejectedMaterialItems';

describe('items rechazados por material (#211)', () => {
  it('une los nombres con comas y una y final', () => {
    expect(joinSpanishAnd([])).toBe('');
    expect(joinSpanishAnd(['Producto 1'])).toBe('Producto 1');
    expect(joinSpanishAnd(['Producto 1', 'producto 2'])).toBe('Producto 1 y producto 2');
    expect(joinSpanishAnd(['Producto 1', 'producto 2', 'producto 3'])).toBe(
      'Producto 1, producto 2 y producto 3',
    );
  });

  it('cuenta 3 materiales y no las marcas', () => {
    const summary = summarizeRejectedMaterials(
      [
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'rejected' },
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'rejected' },
        { requestItemId: 'p2', materialName: 'producto 2', decision: 'rejected' },
        { requestItemId: 'p3', materialName: 'producto 3', decision: 'rejected' },
        { requestItemId: 'p3', materialName: 'producto 3', decision: 'rejected' },
      ],
      3,
    );

    expect(summary.rejectedCount).toBe(3);
    expect(summary.totalCount).toBe(3);
    expect(summary.countLabel).toBe('3 de 3 items rechazados');
    expect(summary.namesLabel).toBe('Producto 1, producto 2 y producto 3');
  });

  it('usa el singular cuando hay un solo material rechazado', () => {
    const summary = summarizeRejectedMaterials(
      [
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'rejected' },
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'rejected' },
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'rejected' },
      ],
      1,
    );

    expect(summary.countLabel).toBe('1 de 1 item rechazado');
    expect(summary.namesLabel).toBe('Producto 1');
    expect(summary.rejectedNames).toEqual(['Producto 1']);
  });

  it('no cuenta el material si se aceptó alguna marca', () => {
    const summary = summarizeRejectedMaterials(
      [
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'accepted' },
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'rejected' },
        { requestItemId: 'p2', materialName: 'producto 2', decision: 'rejected' },
        { requestItemId: 'p2', materialName: 'producto 2', decision: 'rejected' },
      ],
      2,
    );

    expect(summary.rejectedCount).toBe(1);
    expect(summary.countLabel).toBe('1 de 2 items rechazados');
    expect(summary.namesLabel).toBe('producto 2');
  });

  it('no cuenta un material si queda una marca sin decidir', () => {
    const summary = summarizeRejectedMaterials(
      [
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'rejected' },
        { requestItemId: 'p1', materialName: 'Producto 1', decision: 'pending' },
      ],
      1,
    );

    expect(summary.rejectedCount).toBe(0);
    expect(summary.countLabel).toBeNull();
    expect(summary.namesLabel).toBe('');
  });

  it('el tablero del comercio lista por material', () => {
    const screen = readFileSync('src/screens/store/StoreMaterialRequestsScreen.tsx', 'utf8');
    expect(screen).toContain('summarizeRejectedMaterials');
    expect(screen).toContain('namesLabel');
    expect(screen).not.toContain('rejectedItems.length} de');
  });
});
