import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  amountToArsInput,
  formatArs,
  formatMoneyCeilAr,
  maskArsInput,
  parseArsInput,
} from './formatMoney';

describe('formatArs', () => {
  it('agrupa con punto y no depende de Intl', () => {
    expect(formatArs(0)).toBe('$0');
    expect(formatArs(999)).toBe('$999');
    expect(formatArs(1000)).toBe('$1.000');
    expect(formatArs(65000)).toBe('$65.000');
    expect(formatArs(300000)).toBe('$300.000');
    expect(formatArs(1234567)).toBe('$1.234.567');
  });

  it('redondea al peso y no muestra centavos', () => {
    expect(formatArs(65000.4)).toBe('$65.000');
    expect(formatArs(65000.5)).toBe('$65.001');
    expect(formatArs('300000')).toBe('$300.000');
    expect(formatArs(Number.NaN)).toBe('$0');
    expect(formatArs(-20)).toBe('$0');
  });

  it('formatMoneyCeilAr sigue redondeando hacia arriba antes de agrupar', () => {
    expect(formatMoneyCeilAr(10.1)).toBe('$11');
    expect(formatMoneyCeilAr(18000)).toBe('$18.000');
    expect(formatMoneyCeilAr(506)).toBe('$506');
    expect(formatMoneyCeilAr(2300)).toBe('$2.300');
  });
});

describe('máscara de input', () => {
  it('muestra el punto mientras se escribe y parsea el entero', () => {
    expect(maskArsInput('300000')).toBe('300.000');
    expect(parseArsInput('300.000')).toBe(300000);
    expect(parseArsInput('300.000')).not.toBe(300);
    expect(maskArsInput('999')).toBe('999');
    expect(maskArsInput('1000')).toBe('1.000');
    expect(maskArsInput('1234567')).toBe('1.234.567');
    expect(parseArsInput('1.234.567')).toBe(1234567);
  });

  it('ignora lo que no es dígito, recorta a 9 y normaliza ceros', () => {
    expect(maskArsInput('$300.000')).toBe('300.000');
    expect(maskArsInput('000300000')).toBe('300.000');
    expect(maskArsInput('')).toBe('');
    expect(parseArsInput('')).toBeNull();
    expect(maskArsInput('1234567890123')).toBe('123.456.789');
    expect(parseArsInput('123.456.789')).toBe(123456789);
  });

  it('rehidrata un monto numérico ya guardado', () => {
    expect(amountToArsInput(300000)).toBe('300.000');
    expect(amountToArsInput(1.1)).toBe('2');
    expect(amountToArsInput(10.5)).toBe('11');
    expect(parseArsInput(amountToArsInput(300000))).toBe(300000);
  });
});

describe('SQL de recotización (#207)', () => {
  const sql = readFileSync('supabase/20261008_card_207_miles.sql', 'utf8');

  it('solo cambia el texto del monto y conserva los guards de #4', () => {
    const body = sql.replace(/--.*$/gm, '');
    expect(body).toContain('regexp_replace');
    expect(body).not.toContain('FM999999999');
    expect(sql).toContain("RAISE EXCEPTION 'Solo el trabajador puede recotizar'");
    expect(sql).toContain("RAISE EXCEPTION 'Tenés que validar el PIN del cliente antes de recotizar'");
    expect(sql).toContain("RAISE EXCEPTION 'Falta que el cliente pague la diferencia del costo de servicio'");
    expect(sql).toContain("RAISE EXCEPTION 'Ya hay una recotización pendiente'");
    expect(sql).toContain("RAISE EXCEPTION 'Solo el cliente puede aceptar la recotización'");
    expect(sql).toContain("RAISE EXCEPTION 'No hay recotización pendiente'");
    expect(sql).toContain('pendiente_pago_diferencia');
    expect(sql).toContain('calc_precios_contratacion');
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[\s\S]*anon/i);
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
  });

  it('el mensaje del profesional no lleva el desglose del costo de servicio', () => {
    const workerProposal = sql.slice(
      sql.indexOf("'recotizacion_propuesta_trabajador'"),
      sql.indexOf('END;\n$function$;'),
    );
    const workerAccept = sql.slice(sql.lastIndexOf('Tu monto a cobrar pasa a'));
    expect(workerProposal).not.toContain('comision_app');
    expect(workerProposal).not.toContain('precio_final');
    expect(workerAccept).not.toContain('comision_app');
    expect(workerAccept).not.toContain('precio_final');
  });
});
