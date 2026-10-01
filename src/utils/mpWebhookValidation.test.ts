import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRejectedAccessToken } from '../../supabase/functions/_shared/accessToken';
import { secretsMatch } from '../../supabase/functions/_shared/functionSecret';
import {
  buildExternalReference,
  buildMaterialOrderExternalReference,
} from '../../supabase/functions/_shared/mpReference';
import {
  buildMpSignatureManifest,
  hmacSha256Hex,
  mpWebhookSecretStatus,
  paymentMatchesExpectedFee,
  verifyMpWebhookSignature,
} from '../../supabase/functions/_shared/mpWebhookValidation';

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${body}.sig`;
}

describe('firma del webhook de Mercado Pago', () => {
  const secret = 'whsec_test';
  const dataId = '1234567890';
  const requestId = 'req-abc';
  const ts = '1700000000';

  it('exige MP_WEBHOOK_SECRET (503 si falta)', () => {
    expect(mpWebhookSecretStatus('')).toBe(503);
    expect(mpWebhookSecretStatus('   ')).toBe(503);
    expect(mpWebhookSecretStatus(undefined)).toBe(503);
    expect(mpWebhookSecretStatus(secret)).toBeNull();
  });

  it('acepta ts/v1 HMAC y rechaza una firma inválida', async () => {
    const manifest = buildMpSignatureManifest(dataId, requestId, ts);
    expect(manifest).toBe(`id:${dataId};request-id:${requestId};ts:${ts};`);
    const v1 = await hmacSha256Hex(secret, manifest);
    const header = `ts=${ts},v1=${v1}`;

    await expect(
      verifyMpWebhookSignature({
        secret,
        dataId,
        xSignature: header,
        xRequestId: requestId,
      }),
    ).resolves.toBe(true);

    await expect(
      verifyMpWebhookSignature({
        secret,
        dataId,
        xSignature: `ts=${ts},v1=${'ab'.repeat(32)}`,
        xRequestId: requestId,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyMpWebhookSignature({
        secret,
        dataId,
        xSignature: null,
        xRequestId: requestId,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyMpWebhookSignature({
        secret: '',
        dataId,
        xSignature: header,
        xRequestId: requestId,
      }),
    ).resolves.toBe(false);
  });

  it('normaliza data.id alfanumérico a minúsculas en el manifest', async () => {
    const id = 'AbC-12';
    const manifest = buildMpSignatureManifest(id, requestId, ts);
    expect(manifest.startsWith('id:abc-12;')).toBe(true);
    const v1 = await hmacSha256Hex(secret, manifest);
    await expect(
      verifyMpWebhookSignature({
        secret,
        dataId: id,
        xSignature: `ts=${ts}, v1=${v1}`,
        xRequestId: requestId,
      }),
    ).resolves.toBe(true);
  });

  it('mp_webhook responde 503 sin secreto y 401 con firma inválida', () => {
    const src = readFileSync('supabase/functions/mp_webhook/index.ts', 'utf8');
    expect(src).toContain('json(503, { error: "webhook_secret_not_configured" })');
    expect(src).toContain('json(401, { error: "invalid_signature" })');
    expect(src).not.toContain('if (!secret) return true');
  });
});

describe('monto y external_reference del fee', () => {
  const orderA = '11111111-1111-1111-1111-111111111111';
  const orderB = '22222222-2222-2222-2222-222222222222';
  const group = '33333333-3333-3333-3333-333333333333';
  const contratacion = '44444444-4444-4444-4444-444444444444';
  const materialRef = buildMaterialOrderExternalReference(orderA);
  const senaRef = buildExternalReference(contratacion, 'seña_inicial');

  const groupTarget = {
    amount: 5000,
    externalReference: materialRef,
    orderId: orderA,
    paymentGroupId: group,
    groupOrderIds: [orderA, orderB],
  };

  it('acredita approved si el monto es el fee y la referencia es la orden del grupo', () => {
    expect(
      paymentMatchesExpectedFee(
        { status: 'approved', transactionAmount: 5000, externalReference: materialRef },
        groupTarget,
      ),
    ).toEqual({ ok: true });
  });

  it('acepta la orden hermana del mismo payment_group', () => {
    expect(
      paymentMatchesExpectedFee(
        {
          status: 'approved',
          transactionAmount: 5000.0,
          externalReference: buildMaterialOrderExternalReference(orderB),
        },
        groupTarget,
      ),
    ).toEqual({ ok: true });
  });

  it('acepta payment_group_id en la referencia', () => {
    expect(
      paymentMatchesExpectedFee(
        {
          status: 'approved',
          transactionAmount: 5000,
          externalReference: `payment_group_id:${group}|tipo_pago:sena_materiales`,
        },
        { ...groupTarget, externalReference: 'otro' },
      ),
    ).toEqual({ ok: true });
  });

  it('rechaza otro monto, otra orden, otro estado o una contratación distinta', () => {
    expect(
      paymentMatchesExpectedFee(
        { status: 'approved', transactionAmount: 1, externalReference: materialRef },
        groupTarget,
      ),
    ).toEqual({ ok: false, reason: 'amount_mismatch' });

    expect(
      paymentMatchesExpectedFee(
        { status: 'pending', transactionAmount: 5000, externalReference: materialRef },
        groupTarget,
      ),
    ).toEqual({ ok: false, reason: 'not_approved' });

    expect(
      paymentMatchesExpectedFee(
        {
          status: 'approved',
          transactionAmount: 5000,
          externalReference: buildMaterialOrderExternalReference(
            '99999999-9999-9999-9999-999999999999',
          ),
        },
        groupTarget,
      ),
    ).toEqual({ ok: false, reason: 'reference_mismatch' });

    expect(
      paymentMatchesExpectedFee(
        { status: 'approved', transactionAmount: 2200, externalReference: senaRef },
        {
          amount: 2200,
          externalReference: senaRef,
          contratacionId: contratacion,
        },
      ),
    ).toEqual({ ok: true });

    expect(
      paymentMatchesExpectedFee(
        { status: 'approved', transactionAmount: 2200, externalReference: senaRef },
        {
          amount: 2200,
          contratacionId: '55555555-5555-5555-5555-555555555555',
        },
      ),
    ).toEqual({ ok: false, reason: 'reference_mismatch' });
  });
});

describe('secreto de funciones y JWT anónimo', () => {
  it('el secreto tiene que coincidir y no puede ir vacío', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('', 'abc')).toBe(false);
    expect(secretsMatch('abc', '')).toBe(false);
  });

  it('rechaza la anon key pelada, el Bearer anónimo y un JWT sin usuario', () => {
    const anon = jwt({ role: 'anon', iss: 'supabase' });
    const user = jwt({ role: 'authenticated', sub: 'user-1' });
    expect(isRejectedAccessToken(anon, 'otra')).toBe(true);
    expect(isRejectedAccessToken(`Bearer ${anon}`, 'otra')).toBe(true);
    expect(isRejectedAccessToken('sb_anon_key', 'sb_anon_key')).toBe(true);
    expect(isRejectedAccessToken('Bearer sb_anon_key', 'sb_anon_key')).toBe(true);
    expect(isRejectedAccessToken(jwt({ role: 'service_role' }), 'sb_anon_key')).toBe(true);
    expect(isRejectedAccessToken('', 'sb_anon_key')).toBe(true);
    expect(isRejectedAccessToken(user, 'sb_anon_key')).toBe(false);
  });
});
