import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function exportBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('pago del costo de servicio desde el chat', () => {
  it('«Pagar» abre el checkout de la seña y no el detalle ni materiales', () => {
    const src = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const start = src.indexOf('showPay && job');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('showClientPinBar', start);
    expect(end).toBeGreaterThan(start);
    const card = src.slice(start, end);

    expect(card).toContain('Pagar');
    expect(card).not.toContain('Ver pago');
    expect(card).toContain('>Pagar</Text>');
    expect(card).not.toContain('isMercadoPagoEnabled');
    expect(card).toContain('accessibilityLabel="Pagar costo de servicio YaChanga"');
    expect(card).toContain('puedeIniciarPagoCostoServicio(aceptaSaldoFuera)');
    expect(card).toContain('<SaldoFueraDeAppNotice');
    expect(card).toContain('sincronizarSeñaSiPendiente(job.id)');
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

  it('el costo de servicio de materiales no depende del flag de la app', () => {
    const crear = exportBody(src, 'crearPreferenciaCostoServicioMateriales');
    const confirmar = exportBody(src, 'confirmarCostoServicioMaterialesMp');
    expect(crear).toContain('order_id: orderId');
    expect(crear).not.toContain('contratacion_id');
    expect(crear).not.toContain('isMercadoPagoEnabled');
    expect(confirmar).toContain('order_id: orderId');
    expect(confirmar).not.toContain('contratacion_id');
    expect(confirmar).not.toContain('isMercadoPagoEnabled');
  });

  it('resumen, detalle y comparación abren Mercado Pago aunque el flag esté apagado', () => {
    const summary = readFileSync('src/screens/client/MaterialOrderSummaryScreen.tsx', 'utf8');
    const detail = readFileSync('src/screens/client/MaterialOrderDetailScreen.tsx', 'utf8');
    const compare = readFileSync('src/screens/client/ClientCompareQuotesScreen.tsx', 'utf8');
    for (const file of [summary, detail]) {
      expect(file).not.toContain('isMercadoPagoEnabled');
      expect(file).toContain('confirmarCostoServicioMaterialesMp');
      expect(file).toContain('crearPreferenciaCostoServicioMateriales');
      expect(file).toContain('openPagoCheckout');
      expect(file).toContain('mp_not_configured');
    }
    expect(compare).toContain('confirmarCostoServicioMaterialesMp');
    expect(compare).toContain('crearPreferenciaCostoServicioMateriales');
    expect(compare).toContain('openPagoCheckout');
    expect(compare).not.toContain('isMercadoPagoEnabled');
    const card = compare.slice(compare.indexOf('const QuoteCard'));
    expect(card).not.toContain('Pagar costo de servicio');
    expect(card).not.toContain('onPayPending');
    expect(compare).toContain('pendingFeePayLabel');
    expect(compare).toContain('Rechazar toda');
  });
});
