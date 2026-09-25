import { describe, expect, it } from 'vitest';
import {
  buildClientPickupCardContent,
  formatPickupOpeningHours,
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
  contact_revealed_at: '2026-09-25T12:00:00.000Z',
  quotes: {
    freight_type: 'cost',
    stores: {
      name: 'Corralón Norte',
      address: 'Av. Siempre Viva 123, Palermo, CABA, Argentina',
      opening_hours: [{ open: '09:00', close: '18:00' }],
    },
    material_requests: {
      id: '8e665ea6-1111-2222-3333-444444444444',
      title: 'Pedido de materiales',
      request_items: [
        { id: 'ri-1', description: 'Cemento', quantity: 10, unit: 'bolsas', sort_order: 1 },
        { id: 'ri-2', description: 'Cal', quantity: 2, unit: 'bolsas', sort_order: 2 },
      ],
    },
    quote_items: [
      {
        id: 'qi-1',
        client_decision: 'accepted',
        variant_label: 'Loma Negra',
        in_stock: true,
        request_item_id: 'ri-1',
        request_items: { id: 'ri-1', description: 'Cemento', quantity: 10, unit: 'bolsas' },
      },
      {
        id: 'qi-2',
        client_decision: 'rejected',
        in_stock: true,
        request_item_id: 'ri-2',
        request_items: { id: 'ri-2', description: 'Cal', quantity: 2, unit: 'bolsas' },
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
      ['order-1', 'para_retirar'],
      ['order-2', 'historial'],
    ]);
    expect(cards.find((c) => c.orderId === 'order-1')?.pin).toBe('0007');
    expect(cards.find((c) => c.orderId === 'order-2')?.pin).toBe('9999');
  });

  it('arma el resumen con los materiales aceptados y no expone la solicitud', () => {
    const [card] = mapClientPickupOrders([
      {
        ...cement,
        request_id: '8e665ea6-1111-2222-3333-444444444444',
        numero_solicitud: '8E665EA6',
      } as ClientPickupOrderRow & { request_id: string },
    ]);
    const content = buildClientPickupCardContent(card);
    const labels = content.fields.map((field) => field.label);
    const rendered = JSON.stringify(content);

    expect(labels).toContain('Dirección del comercio');
    expect(labels).toContain('Horario de atención');
    expect(labels).toContain('Fecha de disponibilidad');
    expect(labels).toContain('Modalidad de entrega');
    expect(labels).not.toContain('Disponible desde');
    expect(labels).not.toContain('N° solicitud');
    expect(labels).not.toContain('Nº solicitud');
    expect(content.orderCode).toBe('0042');
    expect(rendered).not.toMatch(/solicitud/i);
    expect(rendered).not.toContain('8E665EA6');
    expect(rendered).not.toContain('8e665ea6');
    expect(content.fields.find((field) => field.label === 'Horario de atención')?.value).toBe(
      '09:00 a 18:00',
    );
    expect(content.fields.find((field) => field.label === 'Modalidad de entrega')?.value).toBe(
      'Retiro en local',
    );
    expect(content.materials).toEqual([
      { id: 'ri-1', line: 'Cemento (Loma Negra) · 10 bolsas' },
    ]);
    expect(content.pinDisplay).toBe('0 0 0 7');
    expect(content.pinHint).toBe('Mostralo en el comercio al retirar.');
    const withFreight = mapClientPickupOrders([
      { ...cement, id: 'order-flete', include_freight: true },
    ]);
    expect(
      buildClientPickupCardContent(withFreight[0]).fields.find(
        (field) => field.label === 'Modalidad de entrega',
      )?.value,
    ).toBe('Flete a domicilio');
    const unknownFreight = mapClientPickupOrders([
      { ...cement, id: 'order-sin-flag', include_freight: null },
    ]);
    const unknownMode = buildClientPickupCardContent(unknownFreight[0]).fields.find(
      (field) => field.label === 'Modalidad de entrega',
    )?.value;
    expect(unknownMode).not.toBe('Flete a domicilio');
    expect(unknownMode).not.toBe('Flete incluido');
  });

  it('en el historial muestra la fecha de retiro y no “Disponible desde”', () => {
    const [card] = mapClientPickupOrders([
      {
        ...cement,
        id: 'order-h',
        status: 'completed',
        completed_at: '2026-09-20T12:00:00.000Z',
        include_freight: true,
      },
    ]);
    const content = buildClientPickupCardContent(card);
    const labels = content.fields.map((field) => field.label);
    expect(labels).toContain('Retirado');
    expect(labels).not.toContain('Disponible desde');
    expect(labels).not.toContain('Fecha de disponibilidad');
    expect(content.pinUsed).toBe(true);
    expect(content.pinHint).toBeNull();
    expect(content.fields.find((field) => field.label === 'Modalidad de entrega')?.value).toBe(
      'Flete a domicilio',
    );
  });

  it('formatea el horario semanal del comercio', () => {
    const label = formatPickupOpeningHours([
      { day: 1, slots: [{ open: '09:00', close: '15:00' }] },
      { day: 2, slots: [{ open: '09:00', close: '15:00' }] },
      { day: 3, slots: [{ open: '09:00', close: '15:00' }] },
      { day: 4, slots: [{ open: '09:00', close: '15:00' }] },
      { day: 5, slots: [{ open: '09:00', close: '15:00' }] },
      { day: 6, slots: [{ open: '09:00', close: '13:00' }] },
      { day: 7, slots: [] },
    ]);
    expect(label).toBe('Lun a Vie: 09:00 a 15:00 · Sáb: 09:00 a 13:00 · Dom: cerrado');
  });

  it('la fila de la RPC no publica el número de solicitud', () => {
    const [card] = mapClientPickupOrders([
      {
        order_id: 'order-rpc',
        request_id: '8e665ea6-aaaa-bbbb-cccc-ddddeeeeffff',
        numero_solicitud: '8E665EA6',
        numero_pedido: '4702',
        list_bucket: 'activa',
        title: 'Pedido de materiales',
        store_name: 'Ferretería El Tornillo Loco',
        store_address: 'General Gregorio Aráoz de Lamadrid 25, Centro',
        include_freight: true,
        verification_pin: '3406',
        accepted_total: 8750,
        available_at: '2026-09-25T15:00:00.000Z',
        items: [{ id: 'tornillo', description: 'Tornillos', quantity: 100, unit: 'u' }],
      },
    ]);
    const content = buildClientPickupCardContent(card);
    expect(content.orderCode).toBe('4702');
    expect(JSON.stringify(content)).not.toContain('8E665EA6');
    expect(content.fields.map((field) => field.label)).not.toContain('Nº solicitud');
    expect(content.materials).toEqual([{ id: 'tornillo', line: 'Tornillos · 100 u' }]);
    expect(content.pinDisplay).toBe('3 4 0 6');
    expect(content.fields.find((field) => field.label === 'Modalidad de entrega')?.value).toBe(
      'Flete a domicilio',
    );
  });
});
