import { describe, expect, it } from 'vitest';
import { quoteFreightDisplay } from './quoteFreightTotal';

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
