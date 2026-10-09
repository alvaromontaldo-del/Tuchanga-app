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
    'styles.modalTitle',
    'accessibilityLabel="Enviar presupuesto"',
  );

  it('el modal solo muestra monto, detalle y garantía', () => {
    expect(modal).toContain("editingQuoteId ? 'Editar presupuesto' : 'Cotizar'");
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
      'numberOfLines={1} ellipsizeMode="tail">Presupuesto</Text>',
      'Cargando presupuesto',
    );
    const money = readFileSync('src/components/jobs/QuoteMoneySummary.tsx', 'utf8');
    const worker = sliceBetween(card, 'variant="worker"', 'variant="client"');
    expect(worker).toContain('variant="worker"');
    expect(worker).toContain('formatArs(q.net_amount)');
    expect(worker).not.toContain('q.final_amount');
    expect(money).toContain('Monto a cobrar');
    expect(money).toContain('Precio final');
    expect(money).toContain('Saldo pendiente');
    expect(money).toContain('COSTO_SERVICIO_LABEL');
    expect(money).not.toContain('comprobante de Mercado Pago');

    const shownToClient = sliceBetween(card, 'variant="client"', "q.status !== 'rejected'");
    expect(shownToClient).toContain('variant="client"');
    expect(shownToClient).toContain('q.final_amount');
    expect(shownToClient).toContain('computeSaldoPendiente');
    expect(shownToClient).not.toContain('SaldoFueraDeAppNotice');
    expect(shownToClient).not.toContain('Monto a cobrar');
    expect(card).toContain('quoteWarrantyLabel(q.warranty_days)');
    expect(card).toContain('>Ver servicio<');
    expect(card).toContain("'Rechazar'");
    expect(card).toContain("'Aceptar'");
    expect(chat).toContain("label: 'Pendiente'");
  });

  it('Ver servicio del profesional no muestra precio final ni costo de servicio', () => {
    const prices = sliceBetween(detail, "myRole === 'trabajador' ? (", 'row.fecha_trabajo');
    const worker = prices.slice(0, prices.indexOf(') : ('));
    const client = prices.slice(prices.indexOf(') : ('));
    expect(worker).toContain('variant="worker"');
    expect(worker).toContain('row.precio_trabajador');
    expect(worker).not.toContain('Precio final');
    expect(worker).not.toContain('precio_final');
    expect(worker).not.toContain('comision_app');
    expect(worker).not.toContain('COSTO_SERVICIO_LABEL');

    expect(client).toContain('variant="client"');
    expect(client).toContain('row.precio_final');
    expect(client).toContain('row.comision_app');
    expect(client).toContain('computeSaldoPendiente');
    expect(client).not.toContain('SaldoFueraDeAppNotice');
    expect(detail).not.toContain('comprobante de Mercado Pago');
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

  it('editar un presupuesto pendiente no muestra el desglose y usa el RPC del dueño', () => {
    expect(chat).toContain('accessibilityLabel="Editar presupuesto"');
    expect(chat).toContain('>Editar<');
    expect(modal).toContain('editarCotizacion');
    expect(modal).toContain('contratacionId: editingQuoteId');
    expect(modal).toContain('precioTrabajador: quoteNetNum');
    expect(modal).not.toContain('Costo de servicio YaChanga');
    expect(modal).not.toContain('Precio final');
    expect(modal).not.toContain('q.final_amount');

    const edit = sliceBetween(
      crear,
      'export async function editarCotizacion',
      'export async function aceptarPrecioCotizado',
    );
    expect(edit).toContain("rpc('editar_cotizacion'");
    expect(edit).toContain('p_precio_trabajador: precio');
    expect(edit).toContain('p_service_detail: detail');
    expect(edit).toContain('p_warranty_days: warrantyDays');
    expect(edit).not.toContain('p_comision');
    expect(edit).not.toContain('p_precio_final');

    const sql = readFileSync('supabase/20261009_editar_cotizacion_pendiente.sql', 'utf8');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path TO 'public'");
    expect(sql).toContain('v_row.worker_id <> auth.uid()');
    expect(sql).toContain("v_row.estado_trabajo <> 'precio_cotizado'");
    expect(sql).toContain('calc_precios_contratacion');
    expect(sql).toContain("RAISE EXCEPTION 'Solo el trabajador puede editar la cotización'");
    expect(sql).toContain("RAISE EXCEPTION 'Solo se puede editar un presupuesto pendiente'");
    expect(sql).toContain("RAISE EXCEPTION 'El detalle del servicio es obligatorio'");
    expect(sql).toContain("RAISE EXCEPTION 'Los días de garantía deben ser entre 1 y 60'");
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) FROM anon',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.editar_cotizacion(uuid, numeric, text, integer) TO authenticated',
    );
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[\s\S]*\banon\b/i);
    expect(sql).not.toContain('_chat_notify_contratacion');
    expect(sql).toContain('comision_app = v_precios.comision_app');
    expect(sql).toContain('precio_final = v_precios.precio_final');
  });
});
