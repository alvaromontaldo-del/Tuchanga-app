/** Días de garantía que puede ofrecer el profesional al cotizar. */
export const WARRANTY_DAYS_MIN = 1;
export const WARRANTY_DAYS_MAX = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type WarrantyCountdown =
  | { status: 'none' }
  | { status: 'pending'; totalDays: number }
  | { status: 'active'; totalDays: number; remainingDays: number }
  | { status: 'expired'; totalDays: number };

export function parseWarrantyDaysInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isInteger(n)) return null;
  return n;
}

/** Mensaje en español si el check está activo y los días no están entre 1 y 60. */
export function warrantyDaysError(incluyeGarantia: boolean, days: number | null): string | null {
  if (!incluyeGarantia) return null;
  if (days == null) return 'Indicá los días de garantía (de 1 a 60).';
  if (days < WARRANTY_DAYS_MIN || days > WARRANTY_DAYS_MAX) {
    return 'La garantía puede ser de 1 a 60 días.';
  }
  return null;
}

/** null = sin garantía. Lanza si el valor no entra en 1–60. */
export function assertWarrantyDays(days: number | null | undefined): number | null {
  if (days == null) return null;
  const n = Math.floor(Number(days));
  if (!Number.isInteger(n) || n < WARRANTY_DAYS_MIN || n > WARRANTY_DAYS_MAX) {
    throw new Error('La garantía puede ser de 1 a 60 días.');
  }
  return n;
}

/**
 * Ancla de la cuenta regresiva: la primera vez que el trabajo queda finalizado
 * (`warranty_anchor_at`). No se mueve si después hay un reclamo.
 */
export function warrantyAnchorIso(params: {
  estadoTrabajo?: string | null;
  warrantyAnchorAt?: string | null;
  finalizadoAt?: string | null;
  completedByWorkerAt?: string | null;
}): string | null {
  if (params.warrantyAnchorAt) return params.warrantyAnchorAt;
  if (params.estadoTrabajo === 'finalizado') {
    return params.finalizadoAt ?? params.completedByWorkerAt ?? null;
  }
  return null;
}

function pluralDias(days: number): string {
  return days === 1 ? '1 día' : `${days} días`;
}

/**
 * Días que faltan de garantía.
 * Antes de finalizar el trabajo se muestra el total pactado.
 * Desde el ancla se descuentan días corridos de 24 h. Al cumplirse el plazo, vence.
 */
export function warrantyCountdown(params: {
  warrantyDays: number | null | undefined;
  anchorAt?: string | null;
  now?: Date;
}): WarrantyCountdown {
  if (params.warrantyDays == null || !Number.isFinite(params.warrantyDays)) {
    return { status: 'none' };
  }
  const totalDays = Math.floor(params.warrantyDays);
  if (totalDays <= 0) return { status: 'none' };

  const anchorRaw = params.anchorAt;
  if (!anchorRaw) return { status: 'pending', totalDays };

  const anchorMs = new Date(anchorRaw).getTime();
  if (Number.isNaN(anchorMs)) return { status: 'pending', totalDays };

  const nowMs = (params.now ?? new Date()).getTime();
  const elapsedDays = Math.floor((nowMs - anchorMs) / MS_PER_DAY);
  const remainingDays = Math.max(0, totalDays - Math.max(0, elapsedDays));
  if (remainingDays <= 0) return { status: 'expired', totalDays };
  return { status: 'active', totalDays, remainingDays };
}

export function warrantyCountdownLabel(state: WarrantyCountdown): string | null {
  switch (state.status) {
    case 'none':
      return null;
    case 'pending':
      return `Incluye garantía: ${pluralDias(state.totalDays)}`;
    case 'active':
      return state.remainingDays === 1
        ? 'Garantía: queda 1 día'
        : `Garantía: quedan ${state.remainingDays} días`;
    case 'expired':
      return 'Garantía vencida';
    default:
      return null;
  }
}

/** Texto de la cotización enviada (todavía no corre la cuenta regresiva). */
export function quoteWarrantyLabel(days: number | null | undefined): string {
  return warrantyCountdownLabel(warrantyCountdown({ warrantyDays: days, anchorAt: null })) ?? 'Sin garantía';
}
