import { describe, expect, it } from 'vitest';
import {
  PinBloqueadoError,
  horaBuenosAires,
  mensajePinBloqueado,
  pinBloqueadoDesdeRpc,
  resultadoVerificacionPin,
} from './pinBloqueo';

const HASTA = new Date('2026-10-07T20:04:19.801Z');
const AHORA_DENTRO = Date.parse('2026-10-07T20:00:00.000Z');
const AHORA_VENCIDO = Date.parse('2026-10-07T20:20:00.000Z');

describe('mensaje de PIN bloqueado', () => {
  it('muestra la hora de Buenos Aires', () => {
    expect(horaBuenosAires(HASTA)).toBe('17:04');
    expect(mensajePinBloqueado(HASTA)).toBe(
      'Pusiste mal el PIN 5 veces. Esperá 15 minutos para volver a intentarlo (hasta las 17:04).',
    );
  });

  it('lee el error del RPC aunque no sea una instancia de Error', () => {
    const parsed = pinBloqueadoDesdeRpc({
      message: 'pin_bloqueado',
      details: '2026-10-07T20:04:19.801613+00:00',
      code: 'P0001',
    });
    expect(parsed?.hasta?.toISOString()).toBe('2026-10-07T20:04:19.801Z');
  });

  it('reconoce el texto viejo de producción', () => {
    expect(pinBloqueadoDesdeRpc({ message: 'PIN bloqueado temporalmente' })).toEqual({
      hasta: null,
    });
    expect(pinBloqueadoDesdeRpc({ message: 'Estado inválido para verificar PIN' })).toBeNull();
  });
});

describe('resultado de verificar el PIN', () => {
  it('el 5º fallo, que vuelve en false, avisa el bloqueo con la hora', () => {
    const result = resultadoVerificacionPin({
      ok: false,
      pinIntentosFallidos: 5,
      pinBloqueadoHasta: '2026-10-07T20:04:19.801613+00:00',
      now: AHORA_DENTRO,
    });
    expect(result).toMatchObject({
      type: 'bloqueado',
      message:
        'Pusiste mal el PIN 5 veces. Esperá 15 minutos para volver a intentarlo (hasta las 17:04).',
    });
  });

  it('un intento siguiente usa el error y no el genérico', () => {
    const result = resultadoVerificacionPin({
      ok: null,
      error: { message: 'pin_bloqueado', details: '2026-10-07T20:04:19.801613+00:00' },
      now: AHORA_DENTRO,
    });
    expect(result.type).toBe('bloqueado');
    if (result.type === 'bloqueado') {
      expect(result.message).toContain('hasta las 17:04');
      expect(result.message).not.toBe('No se pudo completar');
    }
  });

  it('con el bloqueo vencido un fallo no se trata como rebloqueo', () => {
    const result = resultadoVerificacionPin({
      ok: false,
      pinIntentosFallidos: 1,
      pinBloqueadoHasta: '2026-10-07T20:04:19.801613+00:00',
      now: AHORA_VENCIDO,
    });
    expect(result).toEqual({
      type: 'incorrecto',
      message: 'PIN incorrecto. Te quedan 4 intentos.',
    });
  });

  it('sin contador recargado no inventa los intentos que faltan', () => {
    expect(resultadoVerificacionPin({ ok: false })).toEqual({
      type: 'incorrecto',
      message: 'PIN incorrecto',
    });
  });

  it('cuenta los intentos que faltan', () => {
    expect(
      resultadoVerificacionPin({ ok: false, pinIntentosFallidos: 4, now: AHORA_DENTRO }),
    ).toEqual({
      type: 'incorrecto',
      message: 'PIN incorrecto. Te queda 1 intento.',
    });
  });

  it('el PIN correcto no muestra error', () => {
    expect(resultadoVerificacionPin({ ok: true })).toEqual({ type: 'ok' });
  });

  it('un PostgrestError sin mensaje no se pierde en blanco', () => {
    const result = resultadoVerificacionPin({
      ok: null,
      error: { code: 'P0001', details: '', hint: '' },
    });
    expect(result).toEqual({ type: 'error', message: 'No se pudo verificar el PIN' });
  });

  it('PinBloqueadoError ya trae el texto para el profesional', () => {
    const error = new PinBloqueadoError(HASTA);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('hasta las 17:04');
    const result = resultadoVerificacionPin({ ok: null, error, now: AHORA_DENTRO });
    expect(result.type).toBe('bloqueado');
  });
});
