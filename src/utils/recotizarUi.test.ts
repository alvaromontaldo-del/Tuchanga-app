import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isRecotizacionChatEvent,
  quoteChipForJob,
  recotizacionCardModel,
  recotizacionLiveStatus,
  recotizarAmountError,
  recotizarFundamentosError,
  serviceFeePayBarCopy,
  WORKER_WAITING_FEE_DIFF,
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
    precioFinal: 23000,
    comision: 5000,
    fundamentos: 'Apareció humedad detrás del mueble.',
  };

  it('el profesional solo ve el monto que va a cobrar', () => {
    const model = recotizacionCardModel({ ...base, role: 'trabajador' });
    expect(model.amountLabel).toBe('Monto a cobrar');
    expect(model.amount).toBe('$18.000');
    expect(model.extraLines).toEqual([]);
    expect(model.showActions).toBe(false);
    expect(model.fundamentos).toContain('humedad');
    expect(JSON.stringify(model)).not.toMatch(FEE_LEAK);
    expect(WORKER_WAITING_FEE_DIFF).not.toMatch(FEE_LEAK);
  });

  it('el cliente ve el pago al profesional, el costo de servicio y puede responder', () => {
    const model = recotizacionCardModel({ ...base, role: 'cliente' });
    expect(model.amountLabel).toBe('Pago al profesional');
    expect(model.extraLines.map((line) => line.label)).toEqual([
      'Costo de servicio YaChanga',
      'Precio final',
    ]);
    expect(model.showActions).toBe(true);
    expect(JSON.stringify(model)).not.toMatch(/apellido|surname/i);
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
    expect(isRecotizacionChatEvent('recotizacion_rechazada')).toBe(true);
    expect(isRecotizacionChatEvent('pin_validado')).toBe(false);
    const closed = recotizacionCardModel({ ...base, role: 'cliente', status: 'rechazada' });
    expect(closed.showActions).toBe(false);
    expect(closed.footnote).toMatch(/monto original/);
  });
});

describe('diferencia de pago', () => {
  it('la seña inicial sigue explicando la ubicación y la diferencia no muestra el costo entero', () => {
    const initial = serviceFeePayBarCopy('aceptado');
    expect(initial.showQuotedFee).toBe(true);
    expect(initial.body).toMatch(/ubicación/);
    const diff = serviceFeePayBarCopy('en_curso');
    expect(diff.showQuotedFee).toBe(false);
    expect(diff.body).toMatch(/solo lo que falta/);
    expect(diff.title).toMatch(/Diferencia/);
  });
});

describe('SQL y pantallas de recotizar', () => {
  const sql = readFileSync('supabase/20261002_card_4_recotizar.sql', 'utf8');
  const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
  const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
  const push = readFileSync('supabase/functions/push_on_message/index.ts', 'utf8');
  const select = readFileSync('src/services/contratacionesSupabase.ts', 'utf8');

  function body(name: string): string {
    const start = sql.indexOf(`FUNCTION public.${name}`);
    expect(start, name).toBeGreaterThan(-1);
    const next = sql.indexOf('\n-- -----', start + 1);
    return next === -1 ? sql.slice(start) : sql.slice(start, next);
  }

  it('recotizar exige PIN, fundamentos y una sola pendiente, y conserva el piso de #39', () => {
    const fn = body('recotizar_en_curso');
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('SET search_path = public');
    expect(fn).toContain("RAISE EXCEPTION 'Solo el trabajador puede recotizar'");
    expect(fn).toContain('pin_intentos');
    expect(fn).toContain('exito = true');
    expect(fn).toContain("RAISE EXCEPTION 'Los fundamentos son obligatorios'");
    expect(fn).toContain("RAISE EXCEPTION 'Ya hay una recotización pendiente'");
    expect(fn).toContain('public.calc_precios_contratacion');
    expect(fn).toContain('v_comision < v_pagado');
    expect(fn).toContain("estado_trabajo = 'pendiente_pago_diferencia'");
    expect(fn).not.toMatch(/\n\s+precio_trabajador = /);
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.recotizar_en_curso(uuid, numeric)');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.recotizar_en_curso(uuid, numeric, text) FROM anon');
  });

  it('aceptar actualiza los montos y deja la diferencia al checkout existente', () => {
    const fn = body('aceptar_recotizacion');
    expect(fn).toContain("RAISE EXCEPTION 'Solo el cliente puede aceptar la recotización'");
    expect(fn).toContain('precio_trabajador = recotizacion_precio_trabajador');
    expect(fn).toContain('precio_final = recotizacion_precio_final');
    expect(fn).toContain('comision_app = recotizacion_comision_app');
    expect(fn).toContain("estado_trabajo = 'en_curso'");
    expect(fn).toContain("'pendiente_seña'::public.contratacion_estado_pago");
    expect(fn).toContain('ELSE estado_pago');
    expect(fn).toContain("estado = 'aceptada'");
    expect(fn).not.toContain('saldo_credito');
  });

  it('rechazar no cambia el precio, no acredita crédito y no cierra el trabajo', () => {
    const fn = body('rechazar_recotizacion');
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
    expect(sql).toContain('recotizaciones_block_direct_writes');
    expect(sql).toContain('recotizaciones_direct_write_forbidden');
    expect(sql).toContain('REVOKE ALL ON TABLE public.recotizaciones FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain('GRANT SELECT ON TABLE public.recotizaciones TO authenticated');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS recotizaciones_una_pendiente');
    expect(sql).toContain('GRANT SELECT (recotizacion_fundamentos, recotizacion_id)');
    expect(select).toContain("'recotizacion_fundamentos'");
    expect(select).toContain("'recotizacion_id'");
    expect(select).toContain('p_fundamentos: fundamentos.trim()');
  });

  it('el modal del profesional no muestra el desglose y el aviso llega por push', () => {
    const modalStart = chat.indexOf('<Text style={styles.modalTitle}>Recotizar</Text>');
    expect(modalStart).toBeGreaterThan(-1);
    const modal = chat.slice(modalStart, chat.indexOf('accessibilityLabel="Enviar recotización"', modalStart));
    expect(modal).toContain('Monto a cobrar');
    expect(modal).toContain('Fundamentos *');
    expect(modal).toContain('recotizarEnCurso');
    expect(modal).not.toMatch(FEE_LEAK);
    expect(modal).not.toContain('10%');
    expect(detail).toContain('<RecotizacionCard');
    expect(detail).toContain('aceptarRecotizacion');
    expect(detail).toContain('rechazarRecotizacion');
    expect(push).toContain('recotizacion_propuesta');
    expect(push).toContain('recotizacion_aceptada');
    expect(push).toContain('recotizacion_rechazada');
    expect(push).toContain('givenNameForClient');
    expect(chat).toContain('showWorkerWaitingFeeDiff');
    expect(chat).toContain('WORKER_WAITING_FEE_DIFF');
    expect(WORKER_WAITING_FEE_DIFF).not.toMatch(FEE_LEAK);
  });
});
