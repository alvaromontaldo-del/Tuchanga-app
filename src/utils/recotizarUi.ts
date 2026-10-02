import { COSTO_SERVICIO_LABEL, COSTO_SERVICIO_PENDIENTE } from '../constants/serviceCostCopy';
import { formatMoneyCeilAr } from './formatMoney';

/** El profesional tiene que explicar el cambio. Mismo piso que la RPC. */
export const RECOTIZAR_FUNDAMENTOS_MIN = 10;
export const RECOTIZAR_FUNDAMENTOS_MAX = 1000;

export type QuoteChipMode = 'cotizar' | 'recotizar' | 'recotizar_pendiente' | 'cotizar_bloqueado';

export type QuoteChip = {
  label: 'Cotizar' | 'Recotizar';
  disabled: boolean;
  mode: QuoteChipMode;
};

/**
 * Después de validar el PIN el trabajo queda `en_curso` y Cotizar pasa a Recotizar.
 * Con una propuesta abierta el botón sigue diciendo Recotizar y no deja mandar otra.
 */
export function quoteChipForJob(input: {
  role: 'cliente' | 'trabajador' | null | undefined;
  estadoTrabajo: string | null | undefined;
  hasActiveJob: boolean;
}): QuoteChip {
  if (input.role !== 'trabajador') {
    return { label: 'Cotizar', disabled: true, mode: 'cotizar_bloqueado' };
  }
  if (input.estadoTrabajo === 'pendiente_pago_diferencia') {
    return { label: 'Recotizar', disabled: true, mode: 'recotizar_pendiente' };
  }
  if (input.estadoTrabajo === 'en_curso') {
    return { label: 'Recotizar', disabled: false, mode: 'recotizar' };
  }
  if (input.hasActiveJob) {
    return { label: 'Cotizar', disabled: true, mode: 'cotizar_bloqueado' };
  }
  return { label: 'Cotizar', disabled: false, mode: 'cotizar' };
}

export function recotizarFundamentosError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Los fundamentos son obligatorios.';
  if (trimmed.length < RECOTIZAR_FUNDAMENTOS_MIN) {
    return 'Contá un poco más por qué cambia el monto.';
  }
  if (trimmed.length > RECOTIZAR_FUNDAMENTOS_MAX) {
    return 'Los fundamentos son demasiado largos.';
  }
  return null;
}

export function recotizarAmountError(amount: number, currentAmount: number | null): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Ingresá el monto que vas a cobrar.';
  if (currentAmount != null && Math.ceil(amount) === Math.ceil(currentAmount)) {
    return 'El monto nuevo tiene que ser distinto del actual.';
  }
  return null;
}

export type RecotizacionStatus = 'pendiente' | 'aceptada' | 'rechazada' | 'respondida';

export type RecotizacionCardModel = {
  title: string;
  badge: string;
  amountLabel: string;
  amount: string;
  /** Solo el cliente. El profesional no ve costo de servicio, precio final ni tramos. */
  extraLines: Array<{ label: string; value: string }>;
  fundamentos: string;
  footnote: string | null;
  showActions: boolean;
};

export function recotizacionLiveStatus(input: {
  event: string;
  messageRecotizacionId: string | null;
  jobEstado: string | null | undefined;
  jobRecotizacionId: string | null | undefined;
}): RecotizacionStatus {
  if (input.event === 'recotizacion_aceptada') return 'aceptada';
  if (input.event === 'recotizacion_rechazada') return 'rechazada';
  if (
    (input.event === 'recotizacion_propuesta' || input.event === 'recotizacion_propuesta_trabajador') &&
    input.jobEstado === 'pendiente_pago_diferencia' &&
    input.messageRecotizacionId != null &&
    input.messageRecotizacionId === input.jobRecotizacionId
  ) {
    return 'pendiente';
  }
  return 'respondida';
}

export function isRecotizacionChatEvent(event: string | null): boolean {
  return (
    event === 'recotizacion_propuesta' ||
    event === 'recotizacion_propuesta_trabajador' ||
    event === 'recotizacion_aceptada' ||
    event === 'recotizacion_rechazada'
  );
}

function badgeFor(status: RecotizacionStatus): string {
  switch (status) {
    case 'pendiente':
      return 'Pendiente';
    case 'aceptada':
      return 'Aceptada';
    case 'rechazada':
      return 'Rechazada';
    default:
      return 'Respondida';
  }
}

function footnoteFor(role: 'cliente' | 'trabajador', status: RecotizacionStatus): string | null {
  if (role === 'trabajador') {
    if (status === 'pendiente') return 'Esperando que el cliente acepte o rechace.';
    if (status === 'aceptada') return 'El cliente aceptó este monto.';
    if (status === 'rechazada') return 'El cliente rechazó el cambio. El trabajo sigue con el monto original.';
    return 'Esta propuesta ya fue respondida.';
  }
  if (status === 'pendiente') return 'Podés aceptarla o rechazarla. Si la rechazás, queda el monto original.';
  if (status === 'aceptada') return 'Aceptaste este monto.';
  if (status === 'rechazada') return 'Rechazaste el cambio. El trabajo sigue con el monto original.';
  return 'Esta propuesta ya fue respondida.';
}

export function recotizacionCardModel(input: {
  role: 'cliente' | 'trabajador';
  status: RecotizacionStatus;
  precioTrabajador: number;
  precioFinal?: number | null;
  comision?: number | null;
  fundamentos: string;
}): RecotizacionCardModel {
  const fundamentos = input.fundamentos.trim();
  const workerView: RecotizacionCardModel = {
    title: 'Recotización',
    badge: badgeFor(input.status),
    amountLabel: 'Monto a cobrar',
    amount: formatMoneyCeilAr(input.precioTrabajador),
    extraLines: [],
    fundamentos,
    footnote: footnoteFor('trabajador', input.status),
    showActions: false,
  };

  if (input.role === 'trabajador') return workerView;

  const extraLines: RecotizacionCardModel['extraLines'] = [];
  if (input.comision != null && Number.isFinite(input.comision)) {
    extraLines.push({
      label: COSTO_SERVICIO_LABEL,
      value: formatMoneyCeilAr(input.comision),
    });
  }
  if (input.precioFinal != null && Number.isFinite(input.precioFinal)) {
    extraLines.push({
      label: 'Precio final',
      value: formatMoneyCeilAr(input.precioFinal),
    });
  }

  return {
    title: 'Recotización',
    badge: badgeFor(input.status),
    amountLabel: 'Pago al profesional',
    amount: formatMoneyCeilAr(input.precioTrabajador),
    extraLines,
    fundamentos,
    footnote: footnoteFor('cliente', input.status),
    showActions: input.status === 'pendiente',
  };
}

export function serviceFeePayBarCopy(estadoTrabajo: string | null | undefined): {
  title: string;
  body: string;
  showQuotedFee: boolean;
} {
  if (estadoTrabajo === 'en_curso') {
    return {
      title: 'Diferencia del costo de servicio',
      body: 'Aceptaste un monto nuevo. Mercado Pago cobra solo lo que falta del costo de servicio YaChanga.',
      showQuotedFee: false,
    };
  }
  return {
    title: COSTO_SERVICIO_PENDIENTE,
    body: 'Para compartir tu ubicación al profesional, se requiere el pago del costo de servicio YaChanga.',
    showQuotedFee: true,
  };
}

export const WORKER_WAITING_FEE_DIFF =
  'Cuando el cliente acredite la diferencia vas a poder marcarlo como realizado.';

export function readMetaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readMetaNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
