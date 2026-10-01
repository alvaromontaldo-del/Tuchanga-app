import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClientQuoteCard, ClientQuoteLineItem } from '../types/materials';
import {
  defaultSelectedItemIds,
  duplicateSelectedMaterials,
  groupQuoteItemsByRequest,
  initialSelectedItemIdsByQuote,
  materialGroupHeader,
  pendingFeePayLabel,
  pendingServiceFeeGroups,
  pickBestQuoteId,
  variantOptionLabel,
  variantSelectionControl,
} from './pickBestQuote';

function item(
  partial: Partial<ClientQuoteLineItem> &
    Pick<ClientQuoteLineItem, 'quoteItemId' | 'requestItemId'>,
): ClientQuoteLineItem {
  return {
    description: 'Material',
    variantLabel: null,
    variantIndex: 1,
    quantity: 1,
    unit: 'u',
    unitPrice: 100,
    lineTotal: 100,
    inStock: true,
    alternativeDescription: null,
    itemNote: null,
    clientDecision: 'pending',
    ...partial,
  };
}

function card(partial: Partial<ClientQuoteCard> & Pick<ClientQuoteCard, 'quoteId'>): ClientQuoteCard {
  return {
    requestId: 'req',
    status: 'sent',
    storeId: partial.quoteId,
    storeName: 'Comercio',
    storeAddress: '',
    storePhone: null,
    contactRevealed: false,
    orderId: null,
    orderStatus: null,
    orderIncludeFreight: null,
    orderAcceptedTotal: null,
    orderCode: null,
    verificationPin: null,
    groupRubroId: 'r1',
    groupRubroName: 'Ferretería',
    rubroNames: ['Ferretería'],
    distanceKm: null,
    freightType: 'pickup',
    freightCost: 0,
    materialsSubtotal: 0,
    total: 0,
    notes: '',
    items: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    openingHoursLabel: null,
    paymentGroupId: null,
    depositAmount: null,
    orderCreatedAt: null,
    checkoutServiceFee: null,
    ...partial,
  };
}

describe('pickBestQuoteId', () => {
  it('elige el menor total y, en empate, el más cercano', () => {
    const pending = card({
      quoteId: 'pending',
      total: 10,
      distanceKm: 0.2,
      orderId: 'ord',
      orderStatus: 'pending_deposit',
    });
    const far = card({ quoteId: 'far', total: 20, distanceKm: 8 });
    const near = card({ quoteId: 'near', total: 20, distanceKm: 1 });
    const pricey = card({ quoteId: 'pricey', total: 40, distanceKm: 0.1 });
    expect(pickBestQuoteId([pending, pricey, far, near])).toBe('near');
  });
});

describe('selección por material', () => {
  const far = card({
    quoteId: 'far',
    total: 120,
    distanceKm: 8,
    items: [
      item({
        quoteItemId: 'a1',
        requestItemId: 'cemento',
        description: 'Cemento',
        variantLabel: 'Marca A',
        variantIndex: 1,
        lineTotal: 100,
        unitPrice: 100,
      }),
      item({
        quoteItemId: 'a2',
        requestItemId: 'cemento',
        description: 'Cemento',
        variantLabel: 'Marca B',
        variantIndex: 2,
        lineTotal: 80,
        unitPrice: 80,
      }),
      item({
        quoteItemId: 'a3',
        requestItemId: 'cal',
        description: 'Cal',
        lineTotal: 40,
        unitPrice: 40,
      }),
    ],
  });
  const near = card({
    quoteId: 'near',
    total: 30,
    distanceKm: 1,
    items: [
      item({
        quoteItemId: 'b1',
        requestItemId: 'cemento',
        description: 'Cemento',
        variantLabel: 'Acme',
        variantIndex: 1,
        lineTotal: 90,
        unitPrice: 90,
      }),
      item({
        quoteItemId: 'b2',
        requestItemId: 'cemento',
        description: 'Cemento',
        variantLabel: 'Barata',
        variantIndex: 2,
        lineTotal: 30,
        unitPrice: 30,
      }),
    ],
  });

  it('la selección por defecto toca solo la mejor cotización del rubro', () => {
    const otherRubro = card({
      quoteId: 'other',
      groupRubroId: 'r2',
      total: 10,
      items: [
        item({
          quoteItemId: 'c1',
          requestItemId: 'arena',
          description: 'Arena',
          lineTotal: 10,
          unitPrice: 10,
        }),
      ],
    });
    expect(pickBestQuoteId([far, near])).toBe('near');
    const selected = initialSelectedItemIdsByQuote([far, near, otherRubro]);
    expect(Object.keys(selected).sort()).toEqual(['near', 'other']);
    expect(selected.near).toEqual(new Set(['b2']));
    expect(selected.other).toEqual(new Set(['c1']));
    expect(selected.far).toBeUndefined();
    expect(defaultSelectedItemIds(near)).toEqual(new Set(['b2']));
  });

  it('mantiene el mismo material en dos comercios y avisa', () => {
    const both = duplicateSelectedMaterials([far, near], {
      far: new Set(['a2', 'a3']),
      near: new Set(['b2']),
    });
    expect(both.labels).toEqual(['Cemento']);
    expect(both.requestItemIds.has('cemento')).toBe(true);
    expect(both.requestItemIds.has('cal')).toBe(false);

    const oneStore = duplicateSelectedMaterials([far, near], {
      far: new Set(['a2']),
      near: new Set(),
    });
    expect(oneStore.labels).toEqual([]);
  });
});

describe('agrupación de variantes', () => {
  it('una sola variante con marca no reemplaza el nombre del material', () => {
    const tijera = item({
      quoteItemId: 'qi-tijera',
      requestItemId: 'ri-tijera',
      description: 'Tijera poda',
      variantLabel: 'Jjh',
      quantity: 2,
      unit: 'u',
      lineTotal: 1200,
      unitPrice: 1200,
      inStock: true,
    });
    const groups = groupQuoteItemsByRequest([tijera]);
    expect(groups).toHaveLength(1);
    expect(groups[0].description).toBe('Tijera poda');
    expect(materialGroupHeader(groups[0])).toBe('Tijera poda · 2 u');
    expect(variantOptionLabel(groups[0].variants[0])).toBe('Jjh');
    expect(variantSelectionControl(groups[0].variants.length)).toBe('checkbox');
  });

  it('varias opciones usan radio y sin marca muestran Precio o la alternativa', () => {
    const groups = groupQuoteItemsByRequest([
      item({
        quoteItemId: 'v1',
        requestItemId: 'ri',
        description: 'Clavo',
        variantLabel: null,
        variantIndex: 1,
        inStock: true,
      }),
      item({
        quoteItemId: 'v2',
        requestItemId: 'ri',
        description: 'Clavo',
        variantLabel: null,
        variantIndex: 2,
        inStock: false,
        alternativeDescription: 'Tornillo',
        lineTotal: 10,
        unitPrice: 10,
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(materialGroupHeader(groups[0])).toBe('Clavo · 1 u');
    expect(variantSelectionControl(groups[0].variants.length)).toBe('radio');
    expect(variantOptionLabel(groups[0].variants[0])).toBe('Precio');
    expect(variantOptionLabel(groups[0].variants[1])).toBe('Tornillo');
  });
});

describe('fee pendiente por grupo', () => {
  it('el fee se cuenta una sola vez aunque el grupo tenga dos comercios', () => {
    const groups = pendingServiceFeeGroups([
      {
        orderId: 'o2',
        orderStatus: 'pending_deposit',
        contactRevealed: false,
        paymentGroupId: 'grp-1',
        depositAmount: 1500,
        orderCreatedAt: '2026-09-02T12:00:00.000Z',
        checkoutServiceFee: 1500,
      },
      {
        orderId: 'o1',
        orderStatus: 'pending',
        contactRevealed: false,
        paymentGroupId: 'grp-1',
        depositAmount: 1500,
        orderCreatedAt: '2026-09-01T12:00:00.000Z',
        checkoutServiceFee: 1500,
      },
    ]);
    expect(groups).toEqual([
      { groupKey: 'grp-1', primaryOrderId: 'o1', serviceFee: 1500, storeCount: 2 },
    ]);
    expect(groups[0].serviceFee).not.toBe(1500 + 1500);
    expect(pendingFeePayLabel('$ 1.500', groups[0].storeCount, groups.length)).toBe(
      'Pagar costo de servicio $ 1.500',
    );
  });

  it('sin checkout toma el máximo de deposit_amount, no la suma', () => {
    const groups = pendingServiceFeeGroups([
      {
        orderId: 'a',
        orderStatus: 'pending_deposit',
        contactRevealed: false,
        paymentGroupId: 'g',
        depositAmount: 400,
        orderCreatedAt: '2026-09-01T00:00:00.000Z',
        checkoutServiceFee: null,
      },
      {
        orderId: 'b',
        orderStatus: 'pending_deposit',
        contactRevealed: false,
        paymentGroupId: 'g',
        depositAmount: 500,
        orderCreatedAt: '2026-09-03T00:00:00.000Z',
        checkoutServiceFee: null,
      },
    ]);
    expect(groups[0].serviceFee).toBe(500);
    expect(groups[0].primaryOrderId).toBe('a');
    expect(groups[0].storeCount).toBe(2);
  });

  it('varios grupos dan un botón cada uno, con la cantidad de comercios', () => {
    const groups = pendingServiceFeeGroups([
      {
        orderId: 'late',
        orderStatus: 'pending_deposit',
        contactRevealed: false,
        paymentGroupId: 'g2',
        depositAmount: 800,
        orderCreatedAt: '2026-09-04T00:00:00.000Z',
        checkoutServiceFee: 800,
      },
      {
        orderId: 'early-1',
        orderStatus: 'pending_deposit',
        contactRevealed: false,
        paymentGroupId: 'g1',
        depositAmount: 1500,
        orderCreatedAt: '2026-09-01T00:00:00.000Z',
        checkoutServiceFee: 1500,
      },
      {
        orderId: 'early-2',
        orderStatus: 'pending_deposit',
        contactRevealed: false,
        paymentGroupId: 'g1',
        depositAmount: 1500,
        orderCreatedAt: '2026-09-02T00:00:00.000Z',
        checkoutServiceFee: 1500,
      },
    ]);
    expect(groups.map((g) => g.groupKey)).toEqual(['g1', 'g2']);
    expect(pendingFeePayLabel('$ 1.500', groups[0].storeCount, groups.length)).toBe(
      'Pagar costo de servicio $ 1.500 · 2 comercios',
    );
    expect(pendingFeePayLabel('$ 800', groups[1].storeCount, groups.length)).toBe(
      'Pagar costo de servicio $ 800 · 1 comercio',
    );
    expect(pendingFeePayLabel('$ 1.500', 2, 1)).toBe('Pagar costo de servicio $ 1.500');
  });
});

describe('datos de la comparación', () => {
  it('pide horario y payment_group_id, y la tarjeta muestra horario y total', () => {
    const src = readFileSync('src/services/clientQuotesSupabase.ts', 'utf8');
    const start = src.indexOf('export async function fetchClientQuotesForRequest');
    const end = src.indexOf('\nexport async function', start + 20);
    const body = src.slice(start, end === -1 ? undefined : end);
    const storeBlocks = [...body.matchAll(/stores \(\n([\s\S]*?)\n\s+\)/g)].map((m) => m[1]);
    expect(storeBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of storeBlocks) expect(block).toContain('opening_hours');
    expect(body).toContain(
      'id, quote_id, deposit_status, status, contact_revealed_at, include_freight, accepted_total, payment_group_id, deposit_amount, created_at',
    );
    expect(body).toContain(
      'id, quote_id, deposit_status, status, contact_revealed_at, accepted_total, payment_group_id, deposit_amount, created_at',
    );
    expect(body).toContain('openingHoursLabel: formatPickupOpeningHours');

    const screen = readFileSync('src/screens/client/ClientCompareQuotesScreen.tsx', 'utf8');
    expect(screen).toContain('Horario:');
    expect(screen).toContain('Horario no informado');
    expect(screen).toContain('Total materiales');
    expect(screen).toContain('materialGroupHeader(');
    expect(screen).toContain('variantOptionLabel(');
    expect(screen).toContain('initialSelectedItemIdsByQuote(');
    const cardSrc = screen.slice(screen.indexOf('const QuoteCard'));
    expect(cardSrc).toContain('materialGroupHeader(group)');
    expect(cardSrc).not.toContain('multi ?');
  });
});
