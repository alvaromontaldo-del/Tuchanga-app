import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  approvalPushBody,
  calendarDateInArgentina,
  categoryFeeLabel,
  pendingCommerceReviewMessage,
  storeIsEligibleForQuotes,
  subscriptionChargeStartsAt,
  subscriptionPhase,
  trialDaysRemaining,
  trialNotice,
} from './storeSubscription';

const SQL = readFileSync('supabase/20261026_card_114_suscripcion_comercios.sql', 'utf8');

function sqlFunction(name: string): string {
  const start = SQL.indexOf(`-- <fn ${name}>`);
  const end = SQL.indexOf(`-- </fn ${name}>`);
  expect(start, name).toBeGreaterThan(-1);
  expect(end, name).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('días de prueba en Argentina', () => {
  it('cuenta el día calendario de Buenos Aires, no el de UTC', () => {
    const now = new Date('2026-10-27T02:30:00.000Z');
    expect(calendarDateInArgentina(now)).toBe('2026-10-26');
    const endsToday = '2026-10-27T02:00:00.000Z';
    expect(trialDaysRemaining(endsToday, now)).toBe(0);
    const endsTomorrowAr = '2026-10-27T15:00:00.000Z';
    expect(trialDaysRemaining(endsTomorrowAr, now)).toBe(1);
    const endedYesterday = '2026-10-26T02:00:00.000Z';
    expect(trialDaysRemaining(endedYesterday, now)).toBe(-1);
  });

  it('sin fecha no inventa un contador', () => {
    expect(trialDaysRemaining(null)).toBeNull();
    expect(trialDaysRemaining('')).toBeNull();
    expect(trialDaysRemaining('no-es-fecha')).toBeNull();
  });
});

describe('textos de la prueba', () => {
  it('el alta usa los días que manda el servidor', () => {
    expect(pendingCommerceReviewMessage(60)).toBe(
      'Tu comercio está siendo revisado por el equipo de YaChanga. Cuando lo aprobemos, empiezan tus 60 días de prueba gratis.',
    );
    expect(pendingCommerceReviewMessage(1)).toContain('empieza tu día de prueba gratis.');
    expect(pendingCommerceReviewMessage(0)).toContain('60 días');
  });

  it('el aviso de 20 y el de 10 usan los días que quedan', () => {
    expect(trialNotice(20, false)?.text).toBe(
      'Te quedan 20 días de prueba gratis. Vinculá tu medio de pago hoy para no perder ventas cuando termine el período.',
    );
    expect(trialNotice(11, false)?.level).toBe('20');
    expect(trialNotice(11, false)?.text).toContain('Te quedan 11 días');
    expect(trialNotice(10, false)).toEqual({
      level: '10',
      text: '¡Atención! Te quedan solo 10 días de prueba gratis. Configurá tu débito automático para evitar la suspensión de tu comercio.',
    });
    expect(trialNotice(1, false)?.text).toContain('Te queda solo 1 día');
    expect(trialNotice(0, false)?.text).toContain('termina hoy');
    expect(trialNotice(21, false)).toBeNull();
    expect(trialNotice(8, true)).toBeNull();
  });

  it('el push de aprobación coincide con el SQL', () => {
    expect(approvalPushBody(60)).toBe(
      '¡Tu comercio fue aprobado! Ya podés usar YaChanga gratis por 60 días.',
    );
    expect(SQL).toContain(
      '¡Tu comercio fue aprobado! Ya podés usar YaChanga gratis por %s %s.',
    );
    expect(SQL).toContain(
      'Te quedan %s días de prueba gratis. Vinculá tu medio de pago hoy para no perder ventas cuando termine el período.',
    );
    expect(SQL).toContain(
      '¡Atención! Te quedan solo %s días de prueba gratis. Configurá tu débito automático para evitar la suspensión de tu comercio.',
    );
    expect(SQL).toContain(
      '¡Atención! Tu prueba gratis termina hoy. Configurá tu débito automático para evitar la suspensión de tu comercio.',
    );
  });
});

describe('elegibilidad SQL', () => {
  const fn = sqlFunction('store_is_eligible_for_quotes');
  const now = new Date('2026-06-15T15:00:00.000Z');

  it('el cuerpo solo deja pasar active vigente y trial vigente', () => {
    expect(fn).toContain("s.status = 'active'");
    expect(fn).toContain('s.current_period_end IS NULL');
    expect(fn).toContain("s.status = 'trial'");
    expect(fn).toContain("AT TIME ZONE 'America/Argentina/Buenos_Aires'");
    expect(fn).not.toContain("'unpaid'");
    expect(fn).not.toContain("'past_due'");
    expect(fn).not.toContain('verification_pin');
  });

  it('trial vigente recibe pedidos y el vencido no', () => {
    expect(
      storeIsEligibleForQuotes({
        status: 'trial',
        trialEndsAt: '2026-06-15T18:00:00.000Z',
        now,
      }),
    ).toBe(true);
    expect(
      storeIsEligibleForQuotes({
        status: 'trial',
        trialEndsAt: '2026-06-14T18:00:00.000Z',
        now,
      }),
    ).toBe(false);
    expect(storeIsEligibleForQuotes({ status: 'trial', trialEndsAt: null, now })).toBe(true);
  });

  it('active legado sigue y el período vencido no', () => {
    expect(storeIsEligibleForQuotes({ status: 'active', currentPeriodEnd: null, now })).toBe(true);
    expect(
      storeIsEligibleForQuotes({
        status: 'active',
        currentPeriodEnd: '2026-06-15T18:00:00.000Z',
        now,
      }),
    ).toBe(true);
    expect(
      storeIsEligibleForQuotes({
        status: 'active',
        currentPeriodEnd: '2026-06-14T18:00:00.000Z',
        now,
      }),
    ).toBe(false);
  });

  it('past_due (unpaid) queda oculto', () => {
    expect(
      storeIsEligibleForQuotes({
        status: 'unpaid',
        trialEndsAt: '2026-12-01T18:00:00.000Z',
        now,
      }),
    ).toBe(false);
    expect(subscriptionPhase({ status: 'unpaid', daysRemaining: 3, currentPeriodEnd: null })).toBe(
      'suspended',
    );
  });
});

describe('contrato SQL de #114', () => {
  it('anon no gana EXECUTE y el comercio no ve el PIN ni los ids de MP', () => {
    const grants = SQL.split('\n').filter((line) => line.includes('GRANT EXECUTE'));
    expect(grants.length).toBeGreaterThan(0);
    for (const line of grants) {
      expect(line).not.toMatch(/\banon\b/);
    }
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.get_my_store_subscription() FROM PUBLIC, anon');
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.admin_get_subscription_settings() FROM PUBLIC, anon',
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.admin_set_trial_days(integer) FROM PUBLIC, anon',
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.admin_set_store_category_fee(text, numeric) FROM PUBLIC, anon',
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.admin_set_store_category(uuid, text) FROM PUBLIC, anon',
    );
    const mine = sqlFunction('get_my_store_subscription');
    expect(mine).not.toContain('verification_pin');
    expect(mine).not.toContain("'mp_preapproval_id'");
    expect(mine).not.toContain("'mp_payer_id'");
    expect(mine).toContain("'debit_linked'");
    expect(mine).not.toContain("'phone'");
    expect(mine).not.toContain("'address'");
    expect(mine).toContain('auth.uid()');
    expect(SQL).toContain('9a2b6f550fd4253ff5d787ca14ed08c2');
    expect(SQL).toContain('918232cd885bde6d70924a6cd161617c');
    expect(SQL).toContain('19c23f633e47bcb3bac3934fb9fdd3eb');
    expect(SQL).toContain('\nBEGIN;\n');
    expect(SQL).toContain('\nCOMMIT;\n');
  });

  it('el precio vacío queda en null y el débito arranca en la prueba o ahora', () => {
    expect(categoryFeeLabel('C', null)).toBe('Categoría C · precio a confirmar');
    expect(categoryFeeLabel('A', 40000)).toBe('Categoría A · $40.000 por mes');
    expect(SQL).toContain("('C', NULL)");
    const now = new Date('2026-10-26T12:00:00.000Z');
    expect(subscriptionChargeStartsAt('2026-12-01T12:00:00.000Z', now).toISOString()).toBe(
      '2026-12-01T12:00:00.000Z',
    );
    expect(subscriptionChargeStartsAt('2026-10-01T12:00:00.000Z', now).getTime()).toBe(
      now.getTime() + 10 * 60 * 1000,
    );
  });
});
