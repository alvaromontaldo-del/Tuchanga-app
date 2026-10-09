import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canShowQuoteStreet } from './quoteCardStreet';

const base = {
  role: 'trabajador' as const,
  quoteId: 'job-1',
  jobId: 'job-1',
  estadoPago: 'seña_pagada',
  estadoTrabajo: 'aceptado',
  fechaTrabajo: '2026-10-10',
};

describe('calle en la tarjeta de presupuesto', () => {
  it('el profesional la ve solo con el costo pago y la agenda confirmada', () => {
    expect(canShowQuoteStreet(base)).toBe(true);
    expect(canShowQuoteStreet({ ...base, estadoPago: 'totalmente_pagado' })).toBe(true);
    expect(canShowQuoteStreet({ ...base, estadoTrabajo: 'en_curso' })).toBe(true);
    expect(canShowQuoteStreet({ ...base, estadoTrabajo: 'pendiente_conformidad' })).toBe(true);
  });

  it('no la ve el cliente, ni un presupuesto pendiente, ni antes de la agenda', () => {
    expect(canShowQuoteStreet({ ...base, role: 'cliente' })).toBe(false);
    expect(canShowQuoteStreet({ ...base, role: null })).toBe(false);
    expect(canShowQuoteStreet({ ...base, estadoPago: 'pendiente_seña' })).toBe(false);
    expect(canShowQuoteStreet({ ...base, fechaTrabajo: null })).toBe(false);
    expect(canShowQuoteStreet({ ...base, fechaTrabajo: '' })).toBe(false);
    expect(canShowQuoteStreet({ ...base, estadoTrabajo: 'precio_cotizado' })).toBe(false);
    expect(canShowQuoteStreet({ ...base, estadoTrabajo: 'precio_aceptado' })).toBe(false);
    expect(canShowQuoteStreet({ ...base, estadoTrabajo: 'cancelado' })).toBe(false);
    expect(canShowQuoteStreet({ ...base, quoteId: 'otro' })).toBe(false);
  });

  it('la tarjeta usa la misma puerta y no parte el título', () => {
    const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
    expect(chat).toContain('canShowQuoteStreet');
    expect(chat).toContain('obtenerDireccionCliente');
    expect(chat).toContain("name=\"location-outline\"");
    expect(chat).toContain('numberOfLines={1}');
    expect(chat).toContain("label: 'Servicio pagado'");
    expect(chat).not.toContain('label: COSTO_SERVICIO_PAGADO');
    expect(detail).toContain("['aceptado', 'en_curso', 'pendiente_conformidad']");
    expect(detail).toContain("row.estado_pago !== 'pendiente_seña'");
  });
});
