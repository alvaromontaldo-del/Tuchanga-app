import { describe, expect, it } from 'vitest';
import {
  MATERIAL_FEE_PAID_MULTI_BODY,
  MATERIAL_FEE_PAID_SINGLE_BODY,
  dedupeMaterialServiceFeePaidMessages,
  type MaterialFeePaidChatMessage,
} from './materialFeePaidChat';

function fee(
  partial: Partial<MaterialFeePaidChatMessage> & Pick<MaterialFeePaidChatMessage, 'id'>,
): MaterialFeePaidChatMessage {
  const extraMeta =
    partial.metadata && typeof partial.metadata === 'object' ? partial.metadata : {};
  return {
    type: 'system',
    text: MATERIAL_FEE_PAID_SINGLE_BODY,
    created_at: '2026-09-28T19:00:00.000Z',
    ...partial,
    metadata: {
      event: 'material_service_fee_paid',
      kind: 'material_order',
      audience: 'todos',
      ...extraMeta,
    },
  };
}

describe('dedupeMaterialServiceFeePaidMessages', () => {
  it('colapsa 2+ comercios del mismo checkout en un solo aviso', () => {
    const quote = {
      id: 'quote',
      type: 'quotation',
      text: 'Cotizaciones de materiales',
      created_at: '2026-09-28T18:40:00.000Z',
    };
    const first = fee({
      id: 'a',
      created_at: '2026-09-28T19:00:00.000Z',
      metadata: { checkout_id: 'chk-1', order_id: 'ord-1' },
    });
    const second = fee({
      id: 'b',
      created_at: '2026-09-28T19:00:01.000Z',
      metadata: { checkout_id: 'chk-1', order_id: 'ord-2' },
    });
    const hello = {
      id: 'hi',
      type: 'text',
      text: 'Hola',
      created_at: '2026-09-28T19:01:00.000Z',
    };

    const out = dedupeMaterialServiceFeePaidMessages([hello, second, first, quote]);

    expect(out.map((m) => m.id)).toEqual(['hi', 'a', 'quote']);
    expect(out.find((m) => m.id === 'a')?.text).toBe(MATERIAL_FEE_PAID_MULTI_BODY);
  });

  it('con un solo comercio deja el texto original', () => {
    const only = fee({
      id: 'solo',
      metadata: { checkout_id: 'chk-1', order_id: 'ord-1', store_count: 1 },
    });

    const out = dedupeMaterialServiceFeePaidMessages([only]);

    expect(out).toEqual([only]);
    expect(out[0]?.text).toBe(MATERIAL_FEE_PAID_SINGLE_BODY);
  });

  it('no pluraliza si el mismo pago se insertó dos veces para una sola orden', () => {
    const first = fee({
      id: 'a',
      created_at: '2026-09-28T19:00:00.000Z',
      metadata: { checkout_id: 'chk-1', order_id: 'ord-1' },
    });
    const retry = fee({
      id: 'b',
      created_at: '2026-09-28T19:00:02.000Z',
      metadata: { checkout_id: 'chk-1', order_id: 'ord-1' },
    });

    const out = dedupeMaterialServiceFeePaidMessages([retry, first]);

    expect(out.map((m) => m.id)).toEqual(['a']);
    expect(out[0]?.text).toBe(MATERIAL_FEE_PAID_SINGLE_BODY);
  });

  it('conserva pagos distintos (otro checkout u otra orden suelta)', () => {
    const group = fee({
      id: 'g',
      metadata: { checkout_id: 'chk-1', order_id: 'ord-1' },
    });
    const otherCheckout = fee({
      id: 'h',
      created_at: '2026-09-28T20:00:00.000Z',
      metadata: { checkout_id: 'chk-2', order_id: 'ord-9' },
    });
    const loose = fee({
      id: 'l',
      created_at: '2026-09-28T21:00:00.000Z',
      metadata: { order_id: 'ord-3' },
    });

    const out = dedupeMaterialServiceFeePaidMessages([group, otherCheckout, loose]);

    expect(out.map((m) => m.id)).toEqual(['g', 'h', 'l']);
    expect(out.every((m) => m.text === MATERIAL_FEE_PAID_SINGLE_BODY)).toBe(true);
  });

  it('usa store_count cuando el duplicado ya se borró en la base', () => {
    const kept = fee({
      id: 'kept',
      text: MATERIAL_FEE_PAID_SINGLE_BODY,
      metadata: { checkout_id: 'chk-1', order_id: 'ord-1', store_count: 2 },
    });

    const out = dedupeMaterialServiceFeePaidMessages([kept]);

    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe(MATERIAL_FEE_PAID_MULTI_BODY);
  });

  it('no toca otros mensajes de sistema', () => {
    const other = {
      id: 'sys',
      type: 'system',
      text: 'Horario confirmado',
      created_at: '2026-09-28T18:00:00.000Z',
      metadata: { event: 'horario_confirmado' },
    };

    expect(dedupeMaterialServiceFeePaidMessages([other, other])).toEqual([other, other]);
  });
});
