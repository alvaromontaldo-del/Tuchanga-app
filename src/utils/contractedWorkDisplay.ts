import { formatMoneyCeilAr } from './formatMoney';
import type { WarrantyCountdown } from './warrantyDays';

/**
 * Nombre visible del profesional en Trabajos contratados.
 * Solo el nombre de pila (`profiles.nombre`). Si el texto trae una inicial
 * de apellido colgada («Alvaro M.»), se descarta. Un nombre compuesto
 * («Ana María») se conserva entero.
 */
export function workerGivenName(nombre: string | null | undefined): string {
  const s = (nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return 'Profesional';
  const withoutInitial = s.replace(/\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]\.?$/u, '').trim();
  return withoutInitial || 'Profesional';
}

/**
 * Monto que cobra el profesional.
 * `precio_final` = pago al profesional + costo de servicio YaChanga (`comision_app`).
 */
export function professionalPayoutAmount(row: {
  precio_trabajador: number;
  precio_final: number;
  comision_app: number;
}): number {
  if (Number.isFinite(row.precio_trabajador) && row.precio_trabajador > 0) {
    return row.precio_trabajador;
  }
  return Math.max(0, (Number(row.precio_final) || 0) - (Number(row.comision_app) || 0));
}

/**
 * Costo de servicio YaChanga de esa changa.
 * Usa `comision_app` guardado. Si falta, es la diferencia entre el total y el pago al profesional.
 */
export function yachangaServiceFeeAmount(row: {
  precio_trabajador: number;
  precio_final: number;
  comision_app: number;
}): number {
  const fee = Number(row.comision_app);
  if (Number.isFinite(fee) && fee > 0) return fee;
  return Math.max(0, (Number(row.precio_final) || 0) - professionalPayoutAmount(row));
}

export type ContractedWorkMoneyDisplay = {
  professionalLabel: string;
  professionalAmount: string;
  serviceFeeLabel: string;
  serviceFeeAmount: string;
};

/** Dos líneas de monto, nunca un total único sin explicar. */
export function contractedWorkMoneyDisplay(row: {
  precio_trabajador: number;
  precio_final: number;
  comision_app: number;
}): ContractedWorkMoneyDisplay {
  return {
    professionalLabel: 'Pago al profesional',
    professionalAmount: formatMoneyCeilAr(professionalPayoutAmount(row)),
    serviceFeeLabel: 'Costo de servicio YaChanga',
    serviceFeeAmount: formatMoneyCeilAr(yachangaServiceFeeAmount(row)),
  };
}

/**
 * Duración / garantía restante en Trabajos contratados.
 * Solo días compactos («24d»). Sin horas ni minutos.
 */
export function contractedWarrantyDurationLabel(state: WarrantyCountdown): string | null {
  switch (state.status) {
    case 'none':
      return null;
    case 'pending':
      return `${state.totalDays}d`;
    case 'active':
      return `${state.remainingDays}d`;
    case 'expired':
      return '0d';
    default:
      return null;
  }
}
