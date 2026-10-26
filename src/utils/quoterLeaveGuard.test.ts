import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SERVICE_QUOTE,
  QUOTER_LEAVE_TITLE,
  materialRequestIsDirty,
  quoterLeaveShouldAsk,
  recotizarDraftIsDirty,
  serviceQuoteIsDirty,
  storeQuoteDraftIsDirty,
} from './quoterLeaveGuard';

describe('salida del cotizador', () => {
  it('pregunta solo si hay datos sin enviar', () => {
    expect(QUOTER_LEAVE_TITLE).toBe('¿Seguro que querés salir del cotizador?');
    expect(serviceQuoteIsDirty(EMPTY_SERVICE_QUOTE)).toBe(false);
    expect(
      serviceQuoteIsDirty({
        amountText: '1.500',
        detail: '',
        warrantyOn: false,
        warrantyDaysText: '',
      }),
    ).toBe(true);
    expect(
      serviceQuoteIsDirty(
        {
          amountText: '12.000',
          detail: 'Cambio de canillas',
          warrantyOn: true,
          warrantyDaysText: '30',
        },
        {
          amountText: '12.000',
          detail: 'Cambio de canillas',
          warrantyOn: true,
          warrantyDaysText: '30',
        },
      ),
    ).toBe(false);
    expect(
      serviceQuoteIsDirty(
        {
          amountText: '15.000',
          detail: 'Cambio de canillas',
          warrantyOn: true,
          warrantyDaysText: '30',
        },
        {
          amountText: '12.000',
          detail: 'Cambio de canillas',
          warrantyOn: true,
          warrantyDaysText: '30',
        },
      ),
    ).toBe(true);

    expect(recotizarDraftIsDirty({ amountText: '', fundamentos: '' })).toBe(false);
    expect(recotizarDraftIsDirty({ amountText: '', fundamentos: 'Faltó un caño' })).toBe(true);

    expect(materialRequestIsDirty({ descriptions: [''], itemCount: 1, rubroTouched: false })).toBe(
      false,
    );
    expect(
      materialRequestIsDirty({ descriptions: ['Manguera'], itemCount: 1, rubroTouched: false }),
    ).toBe(true);
    expect(materialRequestIsDirty({ descriptions: [''], itemCount: 2, rubroTouched: false })).toBe(
      true,
    );
    expect(materialRequestIsDirty({ descriptions: [''], itemCount: 1, rubroTouched: true })).toBe(
      true,
    );

    expect(
      storeQuoteDraftIsDirty({
        locked: false,
        freightType: 'pickup',
        freightCostText: '',
        notes: '',
        items: [],
      }),
    ).toBe(false);
    expect(
      storeQuoteDraftIsDirty({
        locked: true,
        freightType: 'cost',
        freightCostText: '1500',
        notes: 'Listo',
        items: [{ inStock: false, itemNote: 'x', variants: [{ label: 'A', priceText: '10' }] }],
      }),
    ).toBe(false);
    expect(
      storeQuoteDraftIsDirty({
        locked: false,
        freightType: 'pickup',
        freightCostText: '',
        notes: '',
        items: [{ inStock: true, itemNote: '', variants: [{ label: '', priceText: '2.000' }] }],
      }),
    ).toBe(true);

    expect(quoterLeaveShouldAsk({ dirty: true, submitting: true, submitted: false })).toBe(false);
    expect(quoterLeaveShouldAsk({ dirty: true, submitting: false, submitted: true })).toBe(false);
    expect(quoterLeaveShouldAsk({ dirty: false, submitting: false, submitted: false })).toBe(false);
    expect(quoterLeaveShouldAsk({ dirty: true, submitting: false, submitted: false })).toBe(true);
  });

  it('las pantallas usan el modal propio y el atrás', () => {
    const modal = readFileSync('src/components/common/ConfirmLeaveModal.tsx', 'utf8');
    expect(modal).toContain('QUOTER_LEAVE_TITLE');
    expect(modal).toContain('>Cancelar<');
    expect(modal).toContain('>Aceptar<');
    expect(modal).not.toContain('Alert.alert');

    const guard = readFileSync('src/hooks/useQuoterLeaveGuard.ts', 'utf8');
    expect(guard).toContain('BackHandler');
    expect(guard).toContain("'beforeRemove'");

    const materials = readFileSync('src/screens/materials/CreateMaterialRequestScreen.tsx', 'utf8');
    const store = readFileSync('src/screens/store/StoreQuoteRequestScreen.tsx', 'utf8');
    const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    for (const src of [materials, store, chat]) {
      expect(src).toContain('ConfirmLeaveModal');
    }
    expect(materials).toContain('useQuoterLeaveGuard');
    expect(store).toContain('useQuoterLeaveGuard');
    expect(chat).toContain('serviceQuoteIsDirty');
    expect(chat).toContain('BackHandler');
    expect(chat).toContain("'beforeRemove'");
  });
});
