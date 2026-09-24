import { describe, expect, it } from 'vitest';
import {
  buildClientPickupCardContent,
  mapClientPickupOrders,
  type ClientPickupOrderRow,
} from './clientMaterialPickups';

const cement: ClientPickupOrderRow = {
  id: 'order-1',
  order_code: '#YACH-0042',
  status: 'deposit_paid',
  deposit_status: 'paid',
  accepted_total: 15000,
  verification_pin: '7',
  include_freight: false,
  quotes: {
    freight_type: 'cost',
    stores: {
      name: 'Corralón Norte',
      address: 'Av. Siempre Viva 123, Palermo, CABA, Argentina',
      opening_hours: [{ open: '09:00', close: '18:00' }],
    },
    quote_items: [
      {
        id: 'qi-1',
        client_decision: 'accepted',
        variant_label: 'Loma Negra',
        in_stock: true,
        request_items: { description: 'Cemento', quantity: 10, unit: 'bolsas' },
      },
      {
        id: 'qi-2',
        client_decision: 'rejected',
        in_stock: true,
        request_items: { description: 'Cal', quantity: 2, unit: 'bolsas' },
      },
    ],
  },
};

describe('mapClientPickupOrders', () => {
  it('manda el pedido pago a Para retirar y el cerrado al Historial', () => {
    const cards = mapClientPickupOrders([
      cement,
      {
        ...cement,
        id: 'order-2',
        status: 'completed',
        completed_at: '2026-09-01T15:00:00.000Z',
        verification_pin: '9999',
      },
      {
        ...cement,
        id: 'order-3',
        status: 'pending_deposit',
        deposit_status: 'pending',
        contact_revealed_at: null,
      },
    ]);

    expect(cards.map((c) => [c.orderId, c.section])).toEqual([
      ['order-2', 'historial'],
      ['order-1', 'para_retirar'],
    ]);
    expect(cards.find((c) => c.orderId === 'order-1')?.pin).toBe('0007');
    expect(cards.find((c) => c.orderId === 'order-2')?.pin).toBeNull();
  });

  it('arma el resumen con los materiales aceptados y no expone la solicitud', () => {
    const [card] = mapClientPickupOrders([
      {
        ...cement,
        request_id: 'solicitud-secreta',
      } as ClientPickupOrderRow & { request_id: string },
    ]);
    const content = buildClientPickupCardContent(card);
    const labels = content.fields.map((field) => field.label);

    expect(labels).toContain('Dirección');
    expect(labels).toContain('Horario');
    expect(labels).not.toContain('Disponible desde');
    expect(labels).not.toContain('N° solicitud');
    expect(content.fields.find((field) => field.label === 'Horario')?.value).toBe('09:00 a 18:00');
    expect(JSON.stringify(content)).not.toContain('solicitud-secreta');
    expect(content.fields.find((field) => field.label === 'N° pedido')?.value).toBe('0042');
    expect(content.materials).toEqual([
      { id: 'qi-1', line: 'Cemento (Loma Negra) · 10 bolsas' },
    ]);
    expect(content.logistics).toBe('Retiro en local');
    expect(content.pickedUpLabel).toBeNull();
  });

  it('en el historial muestra la fecha de retiro, no la de disponibilidad', () => {
    const [card] = mapClientPickupOrders([
      {
        ...cement,
        id: 'order-h',
        status: 'completed',
        completed_at: '2026-09-20T12:00:00.000Z',
      },
    ]);
    const content = buildClientPickupCardContent(card);
    expect(content.pickedUpLabel).toMatch(/^Retirado el \d{2}\/09\/2026$/);
    expect(content.fields.map((field) => field.label).join(' ')).not.toMatch(/disponible/i);
  });
});
