import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MaterialRequestItem } from '../types/materials';
import { isClientSelectableQuoteItem } from './pickBestQuote';
import {
  buildStoreQuoteItemRows,
  storeChosenReplacementLabel,
  storeQuoteScreenTitle,
  storeReadonlyPriceCaption,
  storeReadonlyPriceOnTitle,
  storeReadonlyStockCaption,
  type QuoteItemDraftState,
} from './storeQuoteDraft';

function requestItem(id: string, description: string): MaterialRequestItem {
  return { id, description, quantity: 1, unit: 'u', sortOrder: 0 };
}

function draft(partial: Partial<QuoteItemDraftState>): QuoteItemDraftState {
  return {
    inStock: true,
    itemPriceText: '',
    variants: [{ label: '', priceText: '' }],
    itemNote: '',
    ...partial,
  };
}

describe('presupuesto del comercio', () => {
  const cemento = requestItem('cemento', 'Cemento');

  it('con stock manda el precio del ítem y las marcas, sin un alternativo', () => {
    const rows = buildStoreQuoteItemRows([cemento], {
      cemento: draft({
        inStock: true,
        itemPriceText: '120',
        variants: [
          { label: 'Acme', priceText: '100' },
          { label: 'Otra', priceText: '80' },
        ],
      }),
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.inStock && row.alternativeDescription == null)).toBe(true);
    expect(rows.map((row) => row.variantLabel)).toEqual([null, 'Acme', 'Otra']);
    expect(rows.map((row) => row.variantIndex)).toEqual([0, 1, 2]);
    expect(rows[0]?.unitPrice).toBe(120);
  });

  it('sin marcas el precio del ítem queda en la variante 1', () => {
    const rows = buildStoreQuoteItemRows([cemento], {
      cemento: draft({ inStock: true, itemPriceText: '50', variants: [] }),
    });
    expect(rows).toEqual([
      expect.objectContaining({
        unitPrice: 50,
        variantIndex: 1,
        variantLabel: null,
        inStock: true,
      }),
    ]);
  });

  it('una marca con precio y sin nombre no se envía', () => {
    expect(() =>
      buildStoreQuoteItemRows([cemento], {
        cemento: draft({
          inStock: true,
          itemPriceText: '50',
          variants: [{ label: '  ', priceText: '80' }],
        }),
      }),
    ).toThrow(/nombre de la marca es obligatorio/);
  });

  it('una marca sin precio se ignora aunque tenga nombre', () => {
    const rows = buildStoreQuoteItemRows([cemento], {
      cemento: draft({
        inStock: true,
        itemPriceText: '50',
        variants: [
          { label: 'Acme', priceText: '' },
          { label: 'Otra', priceText: '0' },
          { label: 'Tigre', priceText: '70' },
        ],
      }),
    });
    expect(rows.map((row) => row.variantLabel)).toEqual([null, 'Tigre']);
    expect(rows.map((row) => row.unitPrice)).toEqual([50, 70]);
  });

  it('sin stock manda un solo reemplazo y descarta las otras marcas', () => {
    const rows = buildStoreQuoteItemRows([cemento], {
      cemento: draft({
        inStock: false,
        variants: [
          { label: 'Cal en bolsa', priceText: '90' },
          { label: 'Otra marca', priceText: '40' },
        ],
      }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inStock: false,
      unitPrice: 90,
      alternativeDescription: 'Cal en bolsa',
      variantLabel: 'Cal en bolsa',
      variantIndex: 1,
    });
    expect(
      isClientSelectableQuoteItem({
        inStock: rows[0].inStock,
        alternativeDescription: rows[0].alternativeDescription,
        variantLabel: rows[0].variantLabel,
        unitPrice: rows[0].unitPrice,
        lineTotal: rows[0].unitPrice,
      }),
    ).toBe(true);
  });

  it('sin stock y campos vacíos no se puede seleccionar', () => {
    const rows = buildStoreQuoteItemRows([cemento], {
      cemento: draft({ inStock: false, variants: [{ label: '  ', priceText: '' }] }),
    });
    expect(rows[0].inStock).toBe(false);
    expect(rows[0].alternativeDescription).toBeNull();
    expect(
      isClientSelectableQuoteItem({
        inStock: false,
        alternativeDescription: null,
        variantLabel: null,
        unitPrice: 0,
        lineTotal: 0,
      }),
    ).toBe(false);
  });

  it('el punto del precio es separador de miles', () => {
    const rows = buildStoreQuoteItemRows([cemento], {
      cemento: draft({
        inStock: true,
        itemPriceText: '300.000',
        variants: [],
      }),
    });
    expect(rows[0]?.unitPrice).toBe(300000);
  });

  it('un alternativo sin precio no se envía', () => {
    expect(() =>
      buildStoreQuoteItemRows([cemento], {
        cemento: draft({
          inStock: false,
          variants: [{ label: 'Cal', priceText: '' }],
        }),
      }),
    ).toThrow(/alternativo/);
  });
});

describe('labels de solo lectura (#209)', () => {
  it('no muestra Con stock y deja Sin stock solo cuando no hay', () => {
    expect(storeReadonlyStockCaption(true)).toBeNull();
    expect(storeReadonlyStockCaption(false)).toBe('Sin stock');
  });

  it('sin marca y una variante no dice Precio; varias siguen en Opción N', () => {
    expect(
      storeReadonlyPriceCaption({ inStock: true, label: '  ', variantCount: 1, index: 0 }),
    ).toBe('');
    expect(
      storeReadonlyPriceCaption({ inStock: true, label: '', variantCount: 2, index: 1 }),
    ).toBe('Opción 2');
    expect(
      storeReadonlyPriceCaption({ inStock: true, label: 'Acme', variantCount: 2, index: 0 }),
    ).toBe('Acme');
    expect(
      storeReadonlyPriceCaption({ inStock: false, label: 'Cal', variantCount: 1, index: 0 }),
    ).toBe('Alternativa');
    expect(
      storeReadonlyPriceCaption({ inStock: false, label: '', variantCount: 1, index: 0 }),
    ).toBe('Sin alternativa');
  });

  it('la pantalla de cotización no dice Con stock ni Precio en solo lectura', () => {
    const screen = readFileSync('src/screens/store/StoreQuoteRequestScreen.tsx', 'utf8');
    expect(screen).not.toContain("'Con stock'");
    expect(screen).not.toContain('"Con stock"');
    expect(screen).not.toContain(": 'Precio'");
    expect(screen).toContain('storeReadonlyStockCaption(');
    expect(screen).toContain('storeReadonlyPriceCaption(');
    expect(screen).toContain('storeReadonlyPriceOnTitle(');
    expect(screen).not.toContain('formatItemQty');
    expect(screen).toContain('Precio unitario');
  });

  it('sin marca el precio va en la fila del nombre; con marca o sin stock no', () => {
    expect(storeReadonlyPriceOnTitle({ inStock: true, variantCount: 1, label: '  ' })).toBe(true);
    expect(storeReadonlyPriceOnTitle({ inStock: true, variantCount: 1, label: 'Acme' })).toBe(
      false,
    );
    expect(storeReadonlyPriceOnTitle({ inStock: true, variantCount: 2, label: '' })).toBe(false);
    expect(storeReadonlyPriceOnTitle({ inStock: false, variantCount: 1, label: '' })).toBe(false);
  });
});

describe('ver cotización del comercio (#211 #215)', () => {
  it('Ver cotización titula Volver y el alta sigue en Cotizar pedido', () => {
    expect(storeQuoteScreenTitle(true)).toBe('Volver');
    expect(storeQuoteScreenTitle(false)).toBe('Cotizar pedido');
  });

  it('una alternativa aceptada muestra su nombre y su precio', () => {
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'accepted',
        variants: [{ label: '  Cal en bolsa  ', priceText: '90' }],
      }),
    ).toEqual({ label: 'Cal en bolsa', priceText: '90' });
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'pending',
        variants: [{ label: 'Cal en bolsa', priceText: '90' }],
      }),
    ).toBeNull();
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'rejected',
        variants: [{ label: 'Cal en bolsa', priceText: '90' }],
      }),
    ).toBeNull();
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'accepted',
        variants: [{ label: '   ', priceText: '90' }],
      }),
    ).toBeNull();
  });

  it('con tres alternativas muestra la segunda aceptada y su precio', () => {
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'accepted',
        variants: [
          { label: 'Marca A', priceText: '100' },
          { label: 'Marca B', priceText: '250' },
          { label: 'Marca C', priceText: '80' },
        ],
        variantDecisions: ['rejected', 'accepted', 'pending'],
      }),
    ).toEqual({ label: 'Marca B', priceText: '250' });
  });

  it('dos alternativas sin decisión individual no inventan elección aunque el ítem figure accepted', () => {
    const variants = [
      { label: 'Marca A', priceText: '100' },
      { label: 'Marca B', priceText: '250' },
    ];
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'accepted',
        variants,
      }),
    ).toBeNull();
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'accepted',
        variants,
        variantDecisions: ['pending', 'pending'],
      }),
    ).toBeNull();
  });

  it('más de una alternativa aceptada vuelve a la vista completa', () => {
    expect(
      storeChosenReplacementLabel({
        inStock: false,
        clientDecision: 'accepted',
        variants: [
          { label: 'Marca A', priceText: '100' },
          { label: 'Marca B', priceText: '250' },
        ],
        variantDecisions: ['accepted', 'accepted'],
      }),
    ).toBeNull();
  });

  it('un ítem con stock no muestra la tarjeta de reemplazo', () => {
    expect(
      storeChosenReplacementLabel({
        inStock: true,
        clientDecision: 'accepted',
        variants: [{ label: 'Acme', priceText: '100' }],
        variantDecisions: ['accepted'],
      }),
    ).toBeNull();
    expect(
      storeChosenReplacementLabel({
        inStock: true,
        clientDecision: 'accepted',
        variants: [
          { label: 'Acme', priceText: '100' },
          { label: 'Otra', priceText: '80' },
        ],
        variantDecisions: ['rejected', 'accepted'],
      }),
    ).toBeNull();
  });

  it('la pantalla no explica la regla cuando ya hay reemplazo y mantiene marca junto al precio', () => {
    const screen = readFileSync('src/screens/store/StoreQuoteRequestScreen.tsx', 'utf8');
    const stack = readFileSync('src/navigation/CommerceStack.tsx', 'utf8');
    const board = readFileSync('src/screens/store/StoreMaterialRequestsScreen.tsx', 'utf8');
    expect(screen).toContain('storeChosenReplacementLabel(');
    expect(screen).toContain('Reemplazo elegido por el cliente');
    expect(screen).toContain("textDecorationLine: 'line-through'");
    expect(screen).toContain('storeQuoteScreenTitle(viewingSentQuote)');
    expect(screen).toContain('useQuoterLeaveGuard');
    expect(screen).toContain('storeQuoteDraftIsDirty');
    expect(screen).not.toContain('gestureEnabled');
    expect(screen).toContain("flexWrap: 'nowrap'");
    expect(screen).not.toContain("flexWrap: 'wrap'");
    expect(screen).toContain('variantPriceField');
    expect(screen).toContain('Precio unitario');
    expect(screen).toContain('Agregar otra marca');
    expect(stack).toContain('storeQuoteScreenTitle(route.params.viewing === true)');
    expect(board).toContain("viewing: card.column !== 'nuevas'");
    const chosenCall = screen.slice(
      screen.indexOf('storeChosenReplacementLabel({'),
      screen.indexOf('if (chosenReplacement)'),
    );
    expect(chosenCall).toContain('variantDecisions');
    expect(chosenCall).not.toContain('.find(');
    const chosenBranch = screen.slice(
      screen.indexOf('if (chosenReplacement)'),
      screen.indexOf('const decisionLabel ='),
    );
    expect(chosenBranch).toContain('chosenReplacement.priceText');
    expect(chosenBranch).toContain('chosenReplacement.label');
    expect(chosenBranch).toContain('formatDraftPrice(chosenPrice)');
    expect(chosenBranch).not.toContain('.find(');
    expect(chosenBranch).not.toContain('El cliente solo puede elegir el reemplazo');
    expect(chosenBranch).not.toContain('Sin stock');
    expect(screen).toContain('El cliente solo puede elegir el reemplazo, no el pedido original.');
  });
});

describe('dirección de entrega para el flete (#102)', () => {
  const sql = readFileSync('supabase/20261005_card_102_store_quote_address.sql', 'utf8');
  const screen = readFileSync('src/screens/store/StoreQuoteRequestScreen.tsx', 'utf8');

  it('el RPC devuelve la calle al comercio destinatario y no exige la orden pagada', () => {
    expect(sql).toContain('get_store_request_client_address');
    expect(sql).toContain('is_store_owner');
    expect(sql).toContain('request_target_stores');
    expect(sql).toContain('direccion_texto');
    expect(sql).toContain('c.cliente_id IS DISTINCT FROM v_professional');
    expect(sql).not.toContain('deposit_status');
    expect(sql).not.toContain('ST_Y');
    expect(sql).not.toContain('ST_X');
    expect(sql).not.toContain('verification_pin');
    expect(sql).not.toContain('calculate_material_service_fee');
  });

  it('la cotización muestra la calle y no las coordenadas', () => {
    expect(screen).toContain('Dirección de entrega');
    expect(screen).toContain('Producto alternativo');
    expect(screen).toContain('No se muestran coordenadas');
    expect(screen).not.toContain('Entrega (coords)');
    expect(screen).not.toContain('clientLat.toFixed');
    expect(screen).toContain('Agregar otra marca');
    expect(screen).toContain('inStock && variants.length < 3');
  });
});
