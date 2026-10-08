import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MaterialRequestItem } from '../types/materials';
import { isClientSelectableQuoteItem } from './pickBestQuote';
import { buildStoreQuoteItemRows, type QuoteItemDraftState } from './storeQuoteDraft';

function requestItem(id: string, description: string): MaterialRequestItem {
  return { id, description, quantity: 1, unit: 'u', sortOrder: 0 };
}

function draft(partial: Partial<QuoteItemDraftState>): QuoteItemDraftState {
  return {
    inStock: true,
    variants: [{ label: '', priceText: '' }],
    itemNote: '',
    ...partial,
  };
}

describe('presupuesto del comercio', () => {
  const cemento = requestItem('cemento', 'Cemento');

  it('con stock manda marcas y no un alternativo', () => {
    const rows = buildStoreQuoteItemRows([cemento], {
      cemento: draft({
        inStock: true,
        variants: [
          { label: 'Acme', priceText: '100' },
          { label: 'Otra', priceText: '80' },
        ],
      }),
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.inStock && row.alternativeDescription == null)).toBe(true);
    expect(rows.map((row) => row.variantLabel)).toEqual(['Acme', 'Otra']);
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
        variants: [{ label: 'Acme', priceText: '300.000' }],
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
