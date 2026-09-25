import { describe, expect, it } from 'vitest';
import { describePaymentStartFailure, paymentStartCause } from './paymentStartError';

describe('paymentStartCause', () => {
  it('lee message de un error plano de PostgREST', () => {
    expect(
      paymentStartCause({
        message: 'column qi.variant_index does not exist',
        code: '42703',
      }),
    ).toContain('column qi.variant_index does not exist');
  });
});

describe('describePaymentStartFailure', () => {
  it('no esconde la causa de la columna faltante y acorta el toast', () => {
    const result = describePaymentStartFailure({
      message: 'column qi.variant_index does not exist',
      code: '42703',
    });
    expect(result.userMessage).toBe('No se pudo preparar el pedido para el pago.');
    expect(result.cause).toContain('variant_index');
  });

  it('conserva un mensaje de negocio ya en español', () => {
    const result = describePaymentStartFailure(
      new Error('Ya hay una orden pendiente para alguno de estos comercios.'),
    );
    expect(result.userMessage).toBe(
      'Ya hay una orden pendiente para alguno de estos comercios.',
    );
    expect(result.cause).toBe(result.userMessage);
  });

  it('resume el rechazo de Mercado Pago y guarda el cuerpo', () => {
    const raw =
      'mp_preference_failed:400:{"message":"auto_return invalid","error":"invalid_back_urls"}';
    const result = describePaymentStartFailure(new Error(raw));
    expect(result.userMessage).toBe('Mercado Pago rechazó el inicio del pago (400).');
    expect(result.cause).toContain('invalid_back_urls');
  });

  it('usa el texto genérico si no hay causa', () => {
    expect(describePaymentStartFailure(null).userMessage).toBe('No se pudo iniciar el pago.');
  });
});
