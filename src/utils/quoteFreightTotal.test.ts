import { describe, expect, it } from 'vitest';
import {
  buildMaterialCheckoutPayload,
  quoteFreightDisplay,
  shownIncludeFreight,
  storeAmountDue,
} from './quoteFreightTotal';

const base = {
  materialsSubtotal: 30,
  freightType: 'cost' as const,
  quotedFreightCost: 15,
};

describe('quoteFreightDisplay', () => {
  it('no suma el flete si la orden lo dejó afuera (retiro en local)', () => {
    const r = quoteFreightDisplay({
      ...base,
      orderIncludeFreight: false,
      uiIncludeFreight: true,
      canChooseFreight: false,
    });
    expect(r.freightAmount).toBe(0);
    expect(r.total).toBe(30);
    expect(r.freightIncluded).toBe(false);
    expect(r.freightRowLabel).toContain('no incluido');
  });

  it('suma materiales + flete si la orden lo incluyó', () => {
    const r = quoteFreightDisplay({
      ...base,
      orderIncludeFreight: true,
      uiIncludeFreight: false,
      canChooseFreight: false,
    });
    expect(r.freightAmount).toBe(15);
    expect(r.total).toBe(45);
    expect(r.freightIncluded).toBe(true);
    expect(r.freightRowLabel).toBe('Flete');
  });

  it('respeta el checkbox mientras no hay orden', () => {
    const off = quoteFreightDisplay({
      ...base,
      orderIncludeFreight: null,
      uiIncludeFreight: false,
      canChooseFreight: true,
    });
    expect(off.total).toBe(30);
    expect(off.freightAmount).toBe(0);

    const on = quoteFreightDisplay({
      ...base,
      orderIncludeFreight: null,
      uiIncludeFreight: true,
      canChooseFreight: true,
    });
    expect(on.total).toBe(45);
    expect(on.freightAmount).toBe(15);
  });

  it('la orden manda aunque el checkbox diga lo contrario', () => {
    const r = quoteFreightDisplay({
      ...base,
      orderIncludeFreight: false,
      uiIncludeFreight: true,
      canChooseFreight: true,
    });
    expect(r.total).toBe(30);
  });

  it('con la selección cerrada no suma el flete cotizado si el flag no llegó', () => {
    const r = quoteFreightDisplay({
      ...base,
      orderIncludeFreight: null,
      uiIncludeFreight: true,
      canChooseFreight: false,
      selectionLocked: true,
    });
    expect(r.freightAmount).toBe(0);
    expect(r.total).toBe(30);
    expect(r.freightIncluded).toBe(false);
  });

  it('si el total de la orden es solo materiales, no muestra el flete aunque el flag sea true', () => {
    const r = quoteFreightDisplay({
      ...base,
      orderIncludeFreight: true,
      uiIncludeFreight: true,
      canChooseFreight: false,
      selectionLocked: true,
      acceptedTotal: 30,
    });
    expect(r.freightAmount).toBe(0);
    expect(r.total).toBe(30);
  });

  it('dos cotizaciones: el flete de una no se copia a la otra', () => {
    const withFreight = quoteFreightDisplay({
      ...base,
      materialsSubtotal: 40,
      orderIncludeFreight: true,
      uiIncludeFreight: false,
      canChooseFreight: false,
      selectionLocked: true,
      acceptedTotal: 55,
    });
    const pickup = quoteFreightDisplay({
      ...base,
      materialsSubtotal: 50,
      orderIncludeFreight: false,
      uiIncludeFreight: true,
      canChooseFreight: false,
      selectionLocked: true,
      acceptedTotal: 65,
    });
    expect(withFreight.freightAmount).toBe(15);
    expect(withFreight.total).toBe(55);
    expect(pickup.freightAmount).toBe(0);
    expect(pickup.total).toBe(50);
    expect(pickup.freightRowLabel).toContain('no incluido');
  });

  it('sin flag, el accepted_total de esa orden dice si el flete entró', () => {
    const off = quoteFreightDisplay({
      ...base,
      materialsSubtotal: 50,
      orderIncludeFreight: null,
      uiIncludeFreight: true,
      canChooseFreight: false,
      selectionLocked: true,
      acceptedTotal: 50,
    });
    const on = quoteFreightDisplay({
      ...base,
      materialsSubtotal: 50,
      orderIncludeFreight: null,
      uiIncludeFreight: false,
      canChooseFreight: false,
      selectionLocked: true,
      acceptedTotal: 65,
    });
    expect(off.total).toBe(50);
    expect(off.freightAmount).toBe(0);
    expect(on.total).toBe(65);
    expect(on.freightAmount).toBe(15);
  });

  it('el checkbox visible y el payload no comparten un solo flete entre cotizaciones', () => {
    const best = {
      orderIncludeFreight: null,
      freightType: 'cost' as const,
      freightCost: 15,
    };
    const other = { ...best };
    expect(shownIncludeFreight(best, undefined, true)).toBe(true);
    expect(shownIncludeFreight(other, undefined, false)).toBe(false);
    expect(shownIncludeFreight({ ...other, orderIncludeFreight: false }, true, true)).toBe(
      false,
    );

    const payload = buildMaterialCheckoutPayload([
      {
        quoteId: 'q-best',
        itemIds: ['a'],
        quoteItemIds: ['qa'],
        includeFreight: shownIncludeFreight(best, true, true),
      },
      {
        quoteId: 'q-other',
        itemIds: ['b'],
        quoteItemIds: ['qb'],
        includeFreight: shownIncludeFreight(other, undefined, false),
      },
    ]);
    expect(payload).toEqual([
      {
        quote_id: 'q-best',
        item_ids: ['a'],
        quote_item_ids: ['qa'],
        include_freight: true,
      },
      {
        quote_id: 'q-other',
        item_ids: ['b'],
        quote_item_ids: ['qb'],
        include_freight: false,
      },
    ]);
  });

  it('el comercio no cobra flete si esa orden lo dejó afuera', () => {
    expect(
      storeAmountDue({
        acceptedItemsSum: 50,
        hasAcceptedItems: true,
        allItemsSum: 80,
        quotedFreightCost: 15,
        freightType: 'cost',
        orderIncludeFreight: false,
        acceptedTotal: 65,
      }),
    ).toBe(50);
    expect(
      storeAmountDue({
        acceptedItemsSum: 40,
        hasAcceptedItems: true,
        allItemsSum: 40,
        quotedFreightCost: 15,
        freightType: 'cost',
        orderIncludeFreight: true,
        acceptedTotal: 55,
      }),
    ).toBe(55);
  });

  it('retiro en local y flete gratis no suman monto', () => {
    expect(
      quoteFreightDisplay({
        ...base,
        freightType: 'pickup',
        quotedFreightCost: 0,
        orderIncludeFreight: null,
        uiIncludeFreight: true,
        canChooseFreight: true,
      }).total,
    ).toBe(30);
    expect(
      quoteFreightDisplay({
        ...base,
        freightType: 'free',
        quotedFreightCost: 0,
        orderIncludeFreight: true,
        uiIncludeFreight: false,
        canChooseFreight: false,
      }).total,
    ).toBe(30);
  });
});
