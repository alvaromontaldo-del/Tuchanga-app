import { formatArs } from './formatMoney';

/** Argentina no usa horario de verano: el día de la prueba se cuenta en esta zona. */
export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export const DEFAULT_TRIAL_DAYS = 60;

/** Misma frase que el push de aprobación en el SQL de #114. */
export function approvalPushBody(trialDays: number): string {
  const n = clampTrialDays(trialDays);
  const unit = n === 1 ? 'día' : 'días';
  return `¡Tu comercio fue aprobado! Ya podés usar YaChanga gratis por ${n} ${unit}.`;
}

export function pendingCommerceReviewMessage(trialDays: number): string {
  const n = clampTrialDays(trialDays);
  if (n === 1) {
    return 'Tu comercio está siendo revisado por el equipo de YaChanga. Cuando lo aprobemos, empieza tu día de prueba gratis.';
  }
  return `Tu comercio está siendo revisado por el equipo de YaChanga. Cuando lo aprobemos, empiezan tus ${n} días de prueba gratis.`;
}

export function clampTrialDays(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 365) return DEFAULT_TRIAL_DAYS;
  return n;
}

export function calendarDateInArgentina(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARGENTINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('No se pudo leer la fecha en Argentina.');
  }
  return `${year}-${month}-${day}`;
}

/**
 * Días de calendario que faltan hasta trial_ends_at, en Argentina.
 * 0 = termina hoy. Negativo = ya venció. null = todavía no hay fecha.
 */
export function trialDaysRemaining(
  trialEndsAt: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (trialEndsAt == null || trialEndsAt === '') return null;
  const end = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return null;
  const endKey = calendarDateInArgentina(end);
  const nowKey = calendarDateInArgentina(now);
  const diff =
    (Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${nowKey}T00:00:00Z`)) / 86_400_000;
  return Math.round(diff);
}

export type TrialNotice = {
  level: '20' | '10';
  text: string;
};

/**
 * Banner y push. Se calculan sobre los días que quedan, no sobre el día 40/50.
 * Si el débito ya está vinculado, no hace falta el aviso.
 */
export function trialNotice(
  daysRemaining: number | null,
  debitLinked: boolean,
): TrialNotice | null {
  if (debitLinked || daysRemaining == null) return null;
  if (!Number.isFinite(daysRemaining) || daysRemaining > 20 || daysRemaining < 0) return null;
  if (daysRemaining <= 10) {
    if (daysRemaining <= 0) {
      return {
        level: '10',
        text: '¡Atención! Tu prueba gratis termina hoy. Configurá tu débito automático para evitar la suspensión de tu comercio.',
      };
    }
    if (daysRemaining === 1) {
      return {
        level: '10',
        text: '¡Atención! Te queda solo 1 día de prueba gratis. Configurá tu débito automático para evitar la suspensión de tu comercio.',
      };
    }
    return {
      level: '10',
      text: `¡Atención! Te quedan solo ${daysRemaining} días de prueba gratis. Configurá tu débito automático para evitar la suspensión de tu comercio.`,
    };
  }
  return {
    level: '20',
    text: `Te quedan ${daysRemaining} días de prueba gratis. Vinculá tu medio de pago hoy para no perder ventas cuando termine el período.`,
  };
}

export type StoreSubscriptionSnapshot = {
  trialDays: number;
  storeId: string | null;
  status: string | null;
  trialEndsAt: string | null;
  daysRemaining: number | null;
  category: string | null;
  monthlyFee: number | null;
  currentPeriodEnd: string | null;
  debitLinked: boolean;
};

export type SubscriptionPhase = 'review' | 'trial' | 'active' | 'suspended' | 'paused' | 'rejected';

/**
 * Misma regla que store_is_eligible_for_quotes en el SQL de #114.
 * unpaid (past_due) no es elegible. active sin current_period_end sigue siéndolo.
 */
export function storeIsEligibleForQuotes(input: {
  status: string | null | undefined;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const today = calendarDateInArgentina(now);
  if (input.status === 'active') {
    if (!input.currentPeriodEnd) return true;
    const end = new Date(input.currentPeriodEnd);
    if (Number.isNaN(end.getTime())) return false;
    return calendarDateInArgentina(end) >= today;
  }
  if (input.status === 'trial') {
    if (!input.trialEndsAt) return true;
    const end = new Date(input.trialEndsAt);
    if (Number.isNaN(end.getTime())) return false;
    return calendarDateInArgentina(end) >= today;
  }
  return false;
}

export function subscriptionPhase(snapshot: {
  status: string | null;
  daysRemaining: number | null;
  currentPeriodEnd: string | null;
  now?: Date;
}): SubscriptionPhase {
  const status = snapshot.status;
  if (!status || status === 'pending_approval') return 'review';
  if (status === 'rejected') return 'rejected';
  if (status === 'paused') return 'paused';
  if (status === 'unpaid') return 'suspended';
  if (status === 'trial') {
    if (snapshot.daysRemaining != null && snapshot.daysRemaining < 0) return 'suspended';
    return 'trial';
  }
  if (status === 'active') {
    if (
      snapshot.currentPeriodEnd &&
      !storeIsEligibleForQuotes({
        status: 'active',
        currentPeriodEnd: snapshot.currentPeriodEnd,
        now: snapshot.now,
      })
    ) {
      return 'suspended';
    }
    return 'active';
  }
  return 'review';
}

export function categoryFeeLabel(category: string | null, monthlyFee: number | null): string {
  if (!category) return 'Todavía no tenés una categoría asignada.';
  if (monthlyFee == null) return `Categoría ${category} · precio a confirmar`;
  return `Categoría ${category} · ${formatArs(monthlyFee)} por mes`;
}

export function subscriptionHeadline(phase: SubscriptionPhase, daysRemaining: number | null): string {
  if (phase === 'review') return 'En revisión';
  if (phase === 'rejected') return 'Rechazado';
  if (phase === 'paused') return 'Pausado';
  if (phase === 'suspended') return 'Suspendido';
  if (phase === 'active') return 'Suscripción activa';
  if (daysRemaining != null && daysRemaining <= 0) return 'Tu prueba termina hoy';
  return 'Prueba gratis';
}

export function subscriptionDetail(input: {
  phase: SubscriptionPhase;
  trialDays: number;
  debitLinked: boolean;
  currentPeriodEnd: string | null;
  now?: Date;
}): string {
  if (input.phase === 'review') return pendingCommerceReviewMessage(input.trialDays);
  if (input.phase === 'rejected') {
    return 'Este comercio no fue aprobado. Si querés, podés volver a enviarlo.';
  }
  if (input.phase === 'paused') {
    return 'El equipo pausó tu comercio. No aparece para pedidos nuevos.';
  }
  if (input.phase === 'suspended') {
    return 'Tu comercio no aparece para pedidos nuevos hasta que regularices el débito.';
  }
  if (input.phase === 'active') {
    if (!input.currentPeriodEnd) return 'Tu débito automático está al día.';
    const end = new Date(input.currentPeriodEnd);
    if (Number.isNaN(end.getTime())) return 'Tu débito automático está al día.';
    const label = new Intl.DateTimeFormat('es-AR', {
      day: 'numeric',
      month: 'long',
      timeZone: ARGENTINA_TIME_ZONE,
    }).format(end);
    return `Tu débito automático está al día. El período sigue hasta el ${label}.`;
  }
  if (input.debitLinked) {
    return 'El débito automático ya está programado. El primer cobro es cuando termine la prueba.';
  }
  return 'Cuando termine la prueba, sin débito automático el comercio deja de recibir pedidos nuevos.';
}

export function canConfigureDebit(phase: SubscriptionPhase): boolean {
  return phase === 'trial' || phase === 'active' || phase === 'suspended' || phase === 'paused';
}

export function debitButtonLabel(phase: SubscriptionPhase, debitLinked: boolean): string {
  if (phase === 'active' || debitLinked) return 'Actualizar débito automático';
  return 'Configurar débito automático';
}

/**
 * Inicio del cobro en MP: trial_ends_at si sigue en el futuro.
 * Si ya venció, unos minutos después de ahora para que MP acepte la fecha.
 */
export function subscriptionChargeStartsAt(
  trialEndsAt: string | null | undefined,
  now: Date = new Date(),
): Date {
  const end = trialEndsAt ? new Date(trialEndsAt) : null;
  if (end && !Number.isNaN(end.getTime()) && end.getTime() > now.getTime() + 60_000) {
    return end;
  }
  return new Date(now.getTime() + 10 * 60 * 1000);
}

export function parseStoreSubscription(data: unknown): StoreSubscriptionSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const fee = row.monthly_fee;
  const monthlyFee =
    fee == null || fee === ''
      ? null
      : Number.isFinite(Number(fee))
        ? Number(fee)
        : null;
  const days = row.days_remaining;
  return {
    trialDays: clampTrialDays(row.trial_days),
    storeId: typeof row.store_id === 'string' ? row.store_id : null,
    status: typeof row.status === 'string' ? row.status : null,
    trialEndsAt: typeof row.trial_ends_at === 'string' ? row.trial_ends_at : null,
    daysRemaining: days == null || days === '' || !Number.isFinite(Number(days)) ? null : Number(days),
    category: typeof row.category === 'string' && row.category ? row.category : null,
    monthlyFee,
    currentPeriodEnd: typeof row.current_period_end === 'string' ? row.current_period_end : null,
    debitLinked: row.debit_linked === true,
  };
}
