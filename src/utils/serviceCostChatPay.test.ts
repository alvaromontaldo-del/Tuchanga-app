import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function exportBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('pago del costo de servicio desde el chat', () => {
  it('«Ver pago» abre el checkout de la seña y no el detalle ni materiales', () => {
    const src = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const start = src.indexOf('Costo de servicio pendiente');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('showClientPinBar', start);
    expect(end).toBeGreaterThan(start);
    const card = src.slice(start, end);

    expect(card).toContain('Ver pago');
    expect(card).toContain('crearPreferenciaSeña(job.id)');
    expect(card).toContain('openPagoCheckout(');
    expect(card).toContain('contratacionId: job.id');
    expect(card).not.toContain('DetalleServicio');
    expect(card).not.toContain('materialOrderId');
    expect(card).not.toContain('crearPreferenciaCostoServicioMateriales');
    expect(card).not.toContain("navigate('ClientCompareQuotes'");
  });

  it('«Ver servicio» del presupuesto sigue yendo al detalle', () => {
    const src = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const start = src.indexOf('>Ver servicio<');
    expect(start).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, start - 500), start);
    expect(around).toContain("navigate('DetalleServicio'");
  });
});

describe('inicio de pago de la seña', () => {
  const src = readFileSync('src/services/pagosMercadoPago.ts', 'utf8');

  it('crearPreferenciaSeña llama a la edge function aunque el flag de la app esté apagado', () => {
    const body = exportBody(src, 'crearPreferenciaSeña');
    expect(body).toContain('contratacion_id: contratacionId');
    expect(body).not.toContain('isMercadoPagoEnabled');
    expect(body).not.toContain('order_id');
  });

  it('confirmar la seña no se corta por el flag de cliente', () => {
    const body = exportBody(src, 'confirmarSeñaMercadoPago');
    expect(body).toContain('contratacion_id: contratacionId');
    expect(body).not.toContain('isMercadoPagoEnabled');
  });

  it('el costo de servicio de materiales sigue usando order_id y el flag', () => {
    const body = exportBody(src, 'crearPreferenciaCostoServicioMateriales');
    expect(body).toContain('isMercadoPagoEnabled');
    expect(body).toContain('order_id: orderId');
    expect(body).not.toContain('contratacion_id');
  });
});
