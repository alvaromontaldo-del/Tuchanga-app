import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isRecotizacionChatEvent,
  isRecotizacionProposalEvent,
  quoteChipForJob,
  RECOTIZACION_SIN_COSTO_EXTRA,
  recotizacionCardModel,
  recotizacionLiveStatus,
  recotizacionResponseById,
  recotizacionStatusForRow,
  recotizarAmountError,
  recotizarFundamentosError,
  resolvePrecioTrabajadorAnterior,
  serviceFeePayBarCopy,
} from './recotizarUi';

const FEE_LEAK = /costo de servicio|precio final|neto|bruto|tramo/i;

describe('botón Cotizar / Recotizar', () => {
  it('antes del PIN sigue siendo Cotizar y se bloquea si hay un trabajo activo', () => {
    expect(
      quoteChipForJob({ role: 'trabajador', estadoTrabajo: 'aceptado', hasActiveJob: true }),
    ).toEqual({ label: 'Cotizar', disabled: true, mode: 'cotizar_bloqueado' });
    expect(
      quoteChipForJob({ role: 'trabajador', estadoTrabajo: 'precio_cotizado', hasActiveJob: false }),
    ).toEqual({ label: 'Cotizar', disabled: false, mode: 'cotizar' });
  });

  it('con el PIN validado (en curso) pasa a Recotizar', () => {
    expect(
      quoteChipForJob({ role: 'trabajador', estadoTrabajo: 'en_curso', hasActiveJob: true }),
    ).toEqual({ label: 'Recotizar', disabled: false, mode: 'recotizar' });
  });

  it('no deja abrir otra mientras hay una pendiente', () => {
    expect(
      quoteChipForJob({
        role: 'trabajador',
        estadoTrabajo: 'pendiente_pago_diferencia',
        hasActiveJob: true,
      }),
    ).toEqual({ label: 'Recotizar', disabled: true, mode: 'recotizar_pendiente' });
  });
});

describe('fundamentos y monto', () => {
  it('exige un texto y un monto distinto del actual', () => {
    expect(recotizarFundamentosError('')).toMatch(/obligatorios/);
    expect(recotizarFundamentosError('corto')).toMatch(/poco más/);
    expect(recotizarFundamentosError('Hay que cambiar el caño que estaba podrido.')).toBeNull();
    expect(recotizarAmountError(0, 10000)).toMatch(/monto/);
    expect(recotizarAmountError(10000, 10000)).toMatch(/distinto/);
    expect(recotizarAmountError(18000, 10000)).toBeNull();
  });
});

describe('tarjeta de recotización', () => {
  const base = {
    status: 'pendiente' as const,
    precioTrabajador: 18000,
    precioTrabajadorAnterior: 10000,
    fundamentos: 'Apareció humedad detrás del mueble.',
  };

  it('el profesional solo ve el monto que va a cobrar', () => {
    const model = recotizacionCardModel({ ...base, role: 'trabajador' });
    expect(model.lines).toEqual([{ label: 'Monto a cobrar', value: '$18.000' }]);
    expect(model.notice).toBeNull();
    expect(model.showActions).toBe(false);
    expect(model.fundamentos).toContain('humedad');
    expect(JSON.stringify(model)).not.toMatch(FEE_LEAK);
  });

  it('el cliente ve el valor anterior tachado, el nuevo y que no paga de más', () => {
    const model = recotizacionCardModel({ ...base, role: 'cliente' });
    expect(model.lines).toEqual([
      { label: 'Valor anterior', value: '$10.000', struck: true },
      { label: 'Valor nuevo', value: '$18.000' },
    ]);
    expect(model.notice).toBe(RECOTIZACION_SIN_COSTO_EXTRA);
    expect(model.showActions).toBe(true);
    expect(JSON.stringify(model)).not.toMatch(FEE_LEAK);
    expect(JSON.stringify(model)).not.toMatch(/apellido|surname/i);
  });

  it('sin monto anterior no inventa la línea tachada', () => {
    const model = recotizacionCardModel({
      ...base,
      role: 'cliente',
      precioTrabajadorAnterior: null,
    });
    expect(model.lines.map((line) => line.label)).toEqual(['Valor nuevo']);
  });

  it('si ya se respondió, la propuesta del chat no vuelve a ofrecer botones', () => {
    expect(
      recotizacionLiveStatus({
        event: 'recotizacion_propuesta',
        messageRecotizacionId: 'a',
        jobEstado: 'en_curso',
        jobRecotizacionId: null,
      }),
    ).toBe('respondida');
    expect(
      recotizacionLiveStatus({
        event: 'recotizacion_propuesta',
        messageRecotizacionId: 'a',
        jobEstado: 'pendiente_pago_diferencia',
        jobRecotizacionId: 'a',
      }),
    ).toBe('pendiente');
    expect(
      recotizacionLiveStatus({
        event: 'recotizacion_propuesta',
        messageRecotizacionId: 'a',
        jobEstado: 'en_curso',
        jobRecotizacionId: null,
        rowEstado: 'aceptada',
      }),
    ).toBe('aceptada');
    expect(
      recotizacionLiveStatus({
        event: 'recotizacion_propuesta',
        messageRecotizacionId: 'a',
        jobEstado: 'en_curso',
        jobRecotizacionId: null,
        responseEvent: 'recotizacion_rechazada',
      }),
    ).toBe('rechazada');
    expect(isRecotizacionProposalEvent('recotizacion_propuesta')).toBe(true);
    expect(isRecotizacionProposalEvent('recotizacion_aceptada')).toBe(false);
    expect(isRecotizacionChatEvent('recotizacion_rechazada')).toBe(true);
    expect(isRecotizacionChatEvent('disputa_abierta')).toBe(false);
    expect(isRecotizacionChatEvent('pin_validado')).toBe(false);
    const closed = recotizacionCardModel({ ...base, role: 'cliente', status: 'aceptada' });
    expect(closed.showActions).toBe(false);
    expect(closed.footnote).toBe('Aceptaste este monto.');
    const rejected = recotizacionCardModel({ ...base, role: 'cliente', status: 'rechazada' });
    expect(rejected.footnote).toMatch(/monto original/);
  });

  it('el monto anterior sale del metadata y, si falta, de recotizaciones', () => {
    expect(resolvePrecioTrabajadorAnterior(12000, 9000)).toBe(12000);
    expect(resolvePrecioTrabajadorAnterior(null, 9000)).toBe(9000);
    expect(resolvePrecioTrabajadorAnterior(null, null)).toBeNull();
    const responses = recotizacionResponseById([
      {
        type: 'system',
        metadata: { event: 'recotizacion_propuesta', recotizacion_id: 'a' },
      },
      {
        type: 'system',
        metadata: { event: 'disputa_abierta', recotizacion_id: 'a' },
      },
      {
        type: 'system',
        metadata: { event: 'recotizacion_aceptada', recotizacion_id: 'a' },
      },
      {
        type: 'text',
        metadata: { event: 'recotizacion_rechazada', recotizacion_id: 'b' },
      },
    ]);
    expect(responses.get('a')).toBe('recotizacion_aceptada');
    expect(responses.has('b')).toBe(false);
    expect(
      recotizacionStatusForRow({
        rowEstado: 'aceptada',
        rowId: 'a',
        jobEstado: 'en_curso',
        jobRecotizacionId: null,
      }),
    ).toBe('aceptada');
    expect(
      recotizacionStatusForRow({
        rowEstado: 'pendiente',
        rowId: 'a',
        jobEstado: 'pendiente_pago_diferencia',
        jobRecotizacionId: 'a',
      }),
    ).toBe('pendiente');
  });
});

describe('pago del costo de servicio inicial', () => {
  it('la seña inicial sigue explicando la ubicación y no ofrece una diferencia', () => {
    const initial = serviceFeePayBarCopy();
    expect(initial.showQuotedFee).toBe(true);
    expect(initial.body).toMatch(/ubicación/);
    expect(initial.title).not.toMatch(/Diferencia/);
    expect(JSON.stringify(initial)).not.toMatch(/solo lo que falta/);
  });
});

describe('SQL y pantallas de recotizar', () => {
  const schemaSql = readFileSync('supabase/20261002_card_4_recotizar.sql', 'utf8');
  const sql = readFileSync('supabase/20261008_card_4_recotizar_sin_cobro.sql', 'utf8');
  const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
  const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
  const push = readFileSync('supabase/functions/push_on_message/index.ts', 'utf8');
  const select = readFileSync('src/services/contratacionesSupabase.ts', 'utf8');

  function body(source: string, name: string): string {
    const start = source.indexOf(`FUNCTION public.${name}`);
    expect(start, name).toBeGreaterThan(-1);
    const nextFn = source.indexOf('\nCREATE OR REPLACE FUNCTION', start + 1);
    const nextSep = source.indexOf('\n-- -----', start + 1);
    const bounds = [nextFn, nextSep].filter((index) => index > start);
    const next = bounds.length > 0 ? Math.min(...bounds) : -1;
    return next === -1 ? source.slice(start) : source.slice(start, next);
  }

  it('recotizar exige PIN, fundamentos y una sola pendiente, y congela la comisión', () => {
    const fn = body(sql, 'recotizar_en_curso');
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain("SET search_path TO 'public'");
    expect(fn).toContain("RAISE EXCEPTION 'Solo el trabajador puede recotizar'");
    expect(fn).toContain('pin_intentos');
    expect(fn).toContain('exito = true');
    expect(fn).toContain("RAISE EXCEPTION 'Los fundamentos son obligatorios'");
    expect(fn).toContain("RAISE EXCEPTION 'Ya hay una recotización pendiente'");
    expect(fn).toContain("RAISE EXCEPTION 'Falta que el cliente pague la diferencia del costo de servicio'");
    expect(fn).toContain('public.calc_precios_contratacion');
    expect(fn).toContain('v_comision := v_pagado');
    expect(fn).not.toContain('v_comision < v_pagado');
    expect(fn).toContain('precio_trabajador_anterior');
    expect(fn).toContain('regexp_replace');
    expect(fn).not.toContain('FM999999999');
    expect(fn).toContain("estado_trabajo = 'pendiente_pago_diferencia'");
    expect(fn).not.toMatch(/\n\s+precio_trabajador = /);
    const workerProposal = fn.slice(fn.indexOf("'recotizacion_propuesta_trabajador'"));
    expect(workerProposal).not.toContain('comision_app');
    expect(workerProposal).not.toContain('precio_final');
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[\s\S]*\banon\b/i);
    expect(schemaSql).toContain('DROP FUNCTION IF EXISTS public.recotizar_en_curso(uuid, numeric)');
    expect(schemaSql).toContain('REVOKE ALL ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) FROM anon');
  });

  it('aceptar actualiza los montos y nunca vuelve a pendiente_seña', () => {
    const fn = body(sql, 'aceptar_recotizacion');
    expect(fn).toContain("RAISE EXCEPTION 'Solo el cliente puede aceptar la recotización'");
    expect(fn).toContain('precio_trabajador = recotizacion_precio_trabajador');
    expect(fn).toContain('precio_final = recotizacion_precio_final');
    expect(fn).toContain('comision_app = recotizacion_comision_app');
    expect(fn).toContain("estado_trabajo = 'en_curso'");
    expect(fn).not.toContain("'pendiente_seña'::public.contratacion_estado_pago");
    expect(fn).not.toMatch(/estado_pago\s*=/);
    expect(fn).not.toContain('Falta pagar la diferencia');
    expect(fn).not.toContain("'diferencia'");
    expect(fn).toContain('No se paga ningún costo adicional.');
    expect(fn).toContain('regexp_replace');
    expect(fn).toContain("estado = 'aceptada'");
    expect(fn).not.toContain('saldo_credito');
    const workerAcceptStart = fn.lastIndexOf('Tu monto a cobrar pasa a');
    const workerAccept = fn.slice(workerAcceptStart, fn.indexOf('$function$;', workerAcceptStart));
    expect(workerAccept).not.toContain('comision_app');
    expect(workerAccept).not.toContain('precio_final');
    expect(workerAccept).not.toContain('Falta pagar');
  });

  it('rechazar no cambia el precio, no acredita crédito y no cierra el trabajo', () => {
    const fn = body(schemaSql, 'rechazar_recotizacion');
    expect(fn).toContain("RAISE EXCEPTION 'Solo el cliente puede rechazar la recotización'");
    expect(fn).toContain("estado_trabajo = 'en_curso'");
    expect(fn).toContain("estado = 'rechazada'");
    expect(fn).not.toContain('saldo_credito');
    expect(fn).not.toMatch(/estado_trabajo = 'finalizado'/);
    expect(fn).not.toMatch(/\n\s+precio_trabajador =/);
    expect(fn).not.toMatch(/\n\s+precio_final =/);
    expect(fn).not.toMatch(/\n\s+comision_app =/);
  });

  it('el historial no se escribe directo y el select pide las columnas nuevas', () => {
    expect(schemaSql).toContain('recotizaciones_block_direct_writes');
    expect(schemaSql).toContain('recotizaciones_direct_write_forbidden');
    expect(schemaSql).toContain('REVOKE ALL ON TABLE public.recotizaciones FROM PUBLIC, anon, authenticated, service_role');
    expect(schemaSql).toContain('GRANT SELECT ON TABLE public.recotizaciones TO authenticated');
    expect(schemaSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS recotizaciones_una_pendiente');
    expect(schemaSql).toContain('GRANT SELECT (recotizacion_fundamentos, recotizacion_id)');
    expect(select).toContain("'recotizacion_fundamentos'");
    expect(select).toContain("'recotizacion_id'");
    expect(select).toContain('p_fundamentos: fundamentos.trim()');
    expect(select).toContain('precio_trabajador_anterior');
    expect(select).not.toContain('comision_app_nuevo');
  });

  it('el modal del profesional no muestra el desglose y el push no pide la diferencia', () => {
    const modalStart = chat.indexOf('<Text style={styles.modalTitle}>Recotizar</Text>');
    expect(modalStart).toBeGreaterThan(-1);
    const modal = chat.slice(modalStart, chat.indexOf('accessibilityLabel="Enviar recotización"', modalStart));
    expect(modal).toContain('Monto a cobrar');
    expect(modal).toContain('Fundamentos *');
    expect(modal).toContain('recotizarEnCurso');
    expect(modal).not.toMatch(FEE_LEAK);
    expect(modal).not.toContain('10%');
    expect(chat).toContain('isRecotizacionProposalEvent');
    expect(chat).not.toContain('WORKER_WAITING_FEE_DIFF');
    expect(chat).not.toContain('showWorkerWaitingFeeDiff');
    expect(chat).not.toContain('Falta pagar la diferencia');
    expect(detail).toContain('<RecotizacionCard');
    expect(detail).toContain('fetchRecotizaciones');
    expect(detail).toContain('aceptarRecotizacion');
    expect(detail).toContain('rechazarRecotizacion');
    expect(detail).not.toContain('precioFinal=');
    expect(detail).not.toContain('comision=');
    expect(push).toContain('recotizacion_propuesta');
    expect(push).toContain('recotizacion_aceptada');
    expect(push).toContain('recotizacion_rechazada');
    expect(push).toContain('givenNameForClient');
    expect(push).not.toContain('Falta pagar la diferencia');
  });
});
