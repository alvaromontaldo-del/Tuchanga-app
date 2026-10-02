import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function sliceBetween(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  expect(i, start).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j, end).toBeGreaterThan(i);
  return src.slice(i, j);
}

describe('cotizar del profesional sin desglose de costo de servicio', () => {
  const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
  const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
  const agenda = readFileSync('src/screens/agenda/AgendaScreen.tsx', 'utf8');
  const fee = readFileSync('src/utils/yachangaJobServiceFee.ts', 'utf8');
  const crear = readFileSync('src/services/contratacionesSupabase.ts', 'utf8');

  const modal = sliceBetween(
    chat,
    '<Text style={styles.modalTitle}>Cotizar</Text>',
    'accessibilityLabel="Enviar presupuesto"',
  );

  it('el modal solo muestra monto, detalle y garantía', () => {
    expect(modal).toContain('Ingresá el monto que querés cobrar.');
    expect(modal).toContain('>Monto a cobrar<');
    expect(modal).toContain('accessibilityLabel="Monto a cobrar"');
    expect(modal).toContain('Detalle del servicio *');
    expect(modal).toContain('multiline');
    expect(modal).toContain('accessibilityLabel="Incluye garantía"');
    expect(modal).toContain('Días de garantía');
    expect(modal).toContain('Puede ir de 1 a 60 días.');

    expect(modal).not.toContain('10% hasta');
    expect(modal).not.toContain('piso de $5.000');
    expect(modal).not.toContain('tope de $23.000');
    expect(modal).not.toContain('Neto (lo que cobrás)');
    expect(modal).not.toContain('Monto neto');
    expect(modal).not.toContain('Costo de servicio YaChanga');
    expect(modal).not.toContain('Precio final');
    expect(modal).not.toContain('quotePreview');
  });

  it('crear y recotizar siguen enviando neto, detalle, reemplazo y días de garantía', () => {
    expect(modal).toContain('netAmount: quoteNetNum');
    expect(modal).toContain('serviceDetail: quoteDetail');
    expect(modal).toContain('replacesQuoteId');
    expect(modal).toContain('warrantyDays: incluyeGarantia ? warrantyDaysNum : null');
    expect(modal).toContain("toast.error('El detalle del servicio es obligatorio.', 'Presupuesto')");
    expect(chat).toContain('>Recotizar<');
    expect(chat).toContain('setReplacesQuoteId(q.id)');
  });

  it('en el chat el profesional ve su monto y el cliente sigue viendo el desglose', () => {
    const card = sliceBetween(
      chat,
      '<Text style={styles.quoteTitle}>Presupuesto</Text>',
      'Cargando presupuesto',
    );
    const worker = sliceBetween(card, "myRole === 'trabajador'", "myRole !== 'trabajador'");
    expect(worker).toContain('Monto a cobrar:');
    expect(worker).toContain('q.net_amount');
    expect(worker).not.toContain('Precio final');
    expect(worker).not.toContain('COSTO_SERVICIO');
    expect(worker).not.toContain('Neto (lo que cobrás)');

    const shownToClient = sliceBetween(
      card,
      "myRole !== 'trabajador'",
      'participants?.myRole === \'cliente\'',
    );
    expect(shownToClient).toContain('Precio final:');
    expect(shownToClient).toContain('q.final_amount');
    expect(shownToClient).toContain('COSTO_SERVICIO_LABEL');
    expect(shownToClient).toContain('Saldo pendiente:');
    expect(shownToClient).toContain('<SaldoFueraDeAppNotice />');
    expect(shownToClient).not.toContain('Monto a cobrar');
    expect(card).toContain('quoteWarrantyLabel(q.warranty_days)');
    expect(card).toContain('>Ver servicio<');
  });

  it('Ver servicio del profesional no muestra precio final ni costo de servicio', () => {
    const prices = sliceBetween(detail, "myRole === 'trabajador' ? (", 'row.fecha_trabajo');
    const worker = prices.slice(0, prices.indexOf(') : ('));
    const client = prices.slice(prices.indexOf(') : ('));
    expect(worker).toContain('Monto a cobrar:');
    expect(worker).toContain('row.precio_trabajador');
    expect(worker).not.toContain('Precio final');
    expect(worker).not.toContain('precio_final');
    expect(worker).not.toContain('comision_app');
    expect(worker).not.toContain('COSTO_SERVICIO_LABEL');

    expect(client).toContain('Precio final:');
    expect(client).toContain('row.precio_final');
    expect(client).toContain('COSTO_SERVICIO_LABEL');
    expect(client).toContain('row.comision_app');
    expect(client).toContain('Saldo pendiente:');
    expect(client).toContain('<SaldoFueraDeAppNotice />');
  });

  it('la agenda del profesional muestra el monto a cobrar, no el precio final', () => {
    expect(agenda).toContain('professionalPayoutAmount(item)');
    expect(agenda).toContain('accessibilityLabel="Monto a cobrar"');
    expect(agenda).not.toContain('item.precio_final');
    expect(agenda).not.toContain('Costo de servicio YaChanga');
    expect(agenda).not.toContain('10% hasta');
  });

  it('el cálculo por tramos sigue en el servidor y en el espejo de display', () => {
    expect(fee).toContain('floorArs: 5_000');
    expect(fee).toContain('capArs: 23_000');
    expect(fee).toContain('rateNumerator: 1_000');
    expect(fee).toContain('rateNumerator: 600');
    expect(fee).toContain('rateNumerator: 300');
    const rpc = sliceBetween(crear, 'export async function crearCotizacion', 'export async function aceptarPrecioCotizado');
    expect(rpc).toContain("rpc('crear_cotizacion'");
    expect(rpc).toContain('p_precio_trabajador: params.precioTrabajador');
    expect(rpc).toContain('p_service_detail: detail');
    expect(rpc).toContain('p_warranty_days: warrantyDays');
    expect(rpc).not.toContain('p_comision');
    expect(rpc).not.toContain('p_precio_final');
  });
});
