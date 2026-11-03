import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isStoreSubscriptionReturn,
  mpFailureLogFields,
  preapprovalResponseKeys,
  resolvePreapprovalCheckoutUrl,
  resolveSubscriptionPayerEmail,
  storeSubscriptionAppReturnUrl,
  SUBSCRIPTION_PAYER_MISSING,
} from '../../supabase/functions/_shared/mpSubscription';

describe('checkout de preapproval (#208)', () => {
  it('usa init_point y, si falta, sandbox_init_point', () => {
    expect(
      resolvePreapprovalCheckoutUrl({
        init_point: ' https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=abc ',
        sandbox_init_point: 'https://sandbox.example/no',
      }),
    ).toBe('https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=abc');
    expect(
      resolvePreapprovalCheckoutUrl({
        sandbox_init_point: ' https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=sbx ',
      }),
    ).toBe('https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=sbx');
  });

  it('sin link devuelve vacío', () => {
    expect(resolvePreapprovalCheckoutUrl({})).toBe('');
    expect(resolvePreapprovalCheckoutUrl({ init_point: '  ', sandbox_init_point: null })).toBe('');
    expect(resolvePreapprovalCheckoutUrl(null)).toBe('');
  });
});

describe('payer de suscripción en sandbox (#208)', () => {
  it('usa solo el comprador de prueba', () => {
    expect(resolveSubscriptionPayerEmail(' buyer@testuser.com ')).toEqual({
      email: 'buyer@testuser.com',
    });
  });

  it('si falta el comprador de prueba no cae a otro mail', () => {
    expect(resolveSubscriptionPayerEmail('')).toEqual(SUBSCRIPTION_PAYER_MISSING);
    expect(resolveSubscriptionPayerEmail('   ')).toEqual(SUBSCRIPTION_PAYER_MISSING);
    expect(resolveSubscriptionPayerEmail(null)).toEqual(SUBSCRIPTION_PAYER_MISSING);
    expect(SUBSCRIPTION_PAYER_MISSING).toEqual({
      error: 'payer_email_missing',
      message: 'Falta configurar el comprador de prueba de Mercado Pago.',
    });
  });
});

describe('logs y retorno de suscripción (#208)', () => {
  it('loguea status, message y cause.code sin mail', () => {
    const fields = mpFailureLogFields(
      400,
      JSON.stringify({
        message: 'Both payer and collector must be test users: real@comercio.com',
        cause: [{ code: 2013 }, { code: 'payer_email' }, { description: 'sin code' }],
      }),
    );
    expect(fields.status).toBe(400);
    expect(fields.message).toBe('Both payer and collector must be test users: [redacted]');
    expect(fields.message).not.toContain('real@comercio.com');
    expect(fields.causeCodes).toEqual(['2013', 'payer_email']);
    expect(mpFailureLogFields(502, 'not-json')).toEqual({
      status: 502,
      message: '',
      causeCodes: [],
    });
  });

  it('el checkout faltante solo expone claves', () => {
    expect(
      preapprovalResponseKeys({
        id: 'pre-1',
        init_point: 'https://secret.example/checkout',
        payer_email: 'buyer@testuser.com',
      }),
    ).toEqual(['id', 'init_point', 'payer_email']);
  });

  it('store_subscription=1 sin orden ni contratación solo redirige', () => {
    expect(
      isStoreSubscriptionReturn({
        storeSubscription: '1',
        materialOrderId: '',
        contratacionId: '  ',
      }),
    ).toBe(true);
    expect(
      isStoreSubscriptionReturn({
        storeSubscription: '1',
        materialOrderId: 'order-1',
        contratacionId: '',
      }),
    ).toBe(false);
    expect(
      isStoreSubscriptionReturn({
        storeSubscription: '0',
        materialOrderId: '',
        contratacionId: '',
      }),
    ).toBe(false);
    expect(storeSubscriptionAppReturnUrl('tuchanga-app/', 'approved')).toBe(
      'tuchanga-app://pagos/retorno?status=approved&store_subscription=1',
    );
    expect(storeSubscriptionAppReturnUrl('', 'unknown')).toBe(
      'tuchanga-app://pagos/retorno?status=pending&store_subscription=1',
    );
  });

  it('la función de suscripción no manda el mail real ni pide sandbox_init_point', () => {
    const src = readFileSync('supabase/functions/mp_crear_suscripcion/index.ts', 'utf8');
    expect(src).toContain('resolveSubscriptionPayerEmail(getMpSandboxBuyerEmail())');
    expect(src).toContain('resolvePreapprovalCheckoutUrl(created)');
    expect(src).toContain('sandbox: true');
    expect(src).toContain('isMpSandboxMode(token)');
    expect(src).toContain('[mp_crear_suscripcion] mp_failed');
    expect(src).toContain('[mp_crear_suscripcion] checkout_missing');
    expect(src).not.toContain('user?.email');
    expect(src).not.toContain('getUserById');
    expect(src).not.toContain('sandbox_init_point ?? ""');
    expect(src).not.toContain('MP_TEST_BUYER_EMAIL');
  });

  it('mp_retorno con suscripción redirige antes de acreditar un pago', () => {
    const src = readFileSync('supabase/functions/mp_retorno/index.ts', 'utf8');
    const guard = src.indexOf('isStoreSubscriptionReturn(');
    const credit = src.indexOf('processApprovedMpPayment(');
    expect(guard).toBeGreaterThan(-1);
    expect(credit).toBeGreaterThan(guard);
    expect(src).toContain('storeSubscriptionAppReturnUrl(getAppReturnBase()');
    expect(src).toContain('store_subscription');
  });
});
