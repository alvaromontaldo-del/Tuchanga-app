import { COSTO_SERVICIO_PENDIENTE } from '../constants/serviceCostCopy';
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

/** Aclaración fija de la opción A. No nombra el costo de servicio ni el precio final. */
export const RECOTIZACION_SIN_COSTO_EXTRA = 'No se paga ningún costo adicional.';

export type RecotizacionMoneyLine = {
  label: string;
  value: string;
  struck?: boolean;
};

export type RecotizacionCardModel = {
  title: string;
  badge: string;
  lines: RecotizacionMoneyLine[];
  /** Solo el cliente. El profesional no ve desglose ni esta aclaración de pago. */
  notice: string | null;
  fundamentos: string;
  footnote: string | null;
  showActions: boolean;
};

export function isRecotizacionProposalEvent(event: string | null): boolean {
  return event === 'recotizacion_propuesta' || event === 'recotizacion_propuesta_trabajador';
}

export function recotizacionLiveStatus(input: {
  event: string;
  messageRecotizacionId: string | null;
  jobEstado: string | null | undefined;
  jobRecotizacionId: string | null | undefined;
  /** Fila de `recotizaciones`, si ya se cargó. */
  rowEstado?: string | null;
  /** Evento de respuesta del mismo `recotizacion_id` en el chat. */
  responseEvent?: string | null;
}): RecotizacionStatus {
  const isProposal = isRecotizacionProposalEvent(input.event);
  if (
    isProposal &&
    input.jobEstado === 'pendiente_pago_diferencia' &&
    input.messageRecotizacionId != null &&
    input.messageRecotizacionId === input.jobRecotizacionId
  ) {
    return 'pendiente';
  }

  if (input.rowEstado === 'aceptada' || input.responseEvent === 'recotizacion_aceptada' || input.event === 'recotizacion_aceptada') {
    return 'aceptada';
  }
  if (input.rowEstado === 'rechazada' || input.responseEvent === 'recotizacion_rechazada' || input.event === 'recotizacion_rechazada') {
    return 'rechazada';
  }
  if (input.rowEstado === 'pendiente' && isProposal) return 'pendiente';
  return 'respondida';
}

/** Estado de una fila de `recotizaciones` en el detalle del servicio. */
export function recotizacionStatusForRow(input: {
  rowEstado: string | null | undefined;
  rowId: string;
  jobEstado: string | null | undefined;
  jobRecotizacionId: string | null | undefined;
}): RecotizacionStatus {
  if (
    input.rowEstado === 'pendiente' &&
    input.jobEstado === 'pendiente_pago_diferencia' &&
    input.jobRecotizacionId === input.rowId
  ) {
    return 'pendiente';
  }
  if (input.rowEstado === 'aceptada') return 'aceptada';
  if (input.rowEstado === 'rechazada') return 'rechazada';
  return 'respondida';
}

/**
 * El metadata nuevo trae el monto anterior. Los mensajes de antes de esta
 * opción lo leen de `recotizaciones.precio_trabajador_anterior`.
 */
export function resolvePrecioTrabajadorAnterior(
  fromMeta: number | null,
  fromRow: number | null | undefined,
): number | null {
  if (fromMeta != null && Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  if (fromRow != null && Number.isFinite(fromRow) && fromRow > 0) return fromRow;
  return null;
}

export function recotizacionResponseById(
  messages: Array<{ type?: string | null; metadata?: Record<string, unknown> | null }>,
): Map<string, 'recotizacion_aceptada' | 'recotizacion_rechazada'> {
  const found = new Map<string, 'recotizacion_aceptada' | 'recotizacion_rechazada'>();
  for (const message of messages) {
    if (message.type != null && message.type !== 'system') continue;
    const meta = message.metadata;
    if (!meta) continue;
    const event = meta.event;
    const id = meta.recotizacion_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (event === 'recotizacion_aceptada' || event === 'recotizacion_rechazada') {
      found.set(id, event);
    }
  }
  return found;
}

export function isRecotizacionChatEvent(event: string | null): boolean {
  return (
    isRecotizacionProposalEvent(event) ||
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
  precioTrabajadorAnterior?: number | null;
  fundamentos: string;
}): RecotizacionCardModel {
  const fundamentos = input.fundamentos.trim();
  const workerView: RecotizacionCardModel = {
    title: 'Recotización',
    badge: badgeFor(input.status),
    lines: [{ label: 'Monto a cobrar', value: formatMoneyCeilAr(input.precioTrabajador) }],
    notice: null,
    fundamentos,
    footnote: footnoteFor('trabajador', input.status),
    showActions: false,
  };

  if (input.role === 'trabajador') return workerView;

  const lines: RecotizacionMoneyLine[] = [];
  const anterior = input.precioTrabajadorAnterior;
  if (anterior != null && Number.isFinite(anterior)) {
    lines.push({
      label: 'Valor anterior',
      value: formatMoneyCeilAr(anterior),
      struck: true,
    });
  }
  lines.push({
    label: 'Valor nuevo',
    value: formatMoneyCeilAr(input.precioTrabajador),
  });

  return {
    title: 'Recotización',
    badge: badgeFor(input.status),
    lines,
    notice: RECOTIZACION_SIN_COSTO_EXTRA,
    fundamentos,
    footnote: footnoteFor('cliente', input.status),
    showActions: input.status === 'pendiente',
  };
}

/** Barra del costo de servicio inicial (antes del PIN). La recotización no cobra diferencia. */
export function serviceFeePayBarCopy(): {
  title: string;
  body: string;
  showQuotedFee: boolean;
} {
  return {
    title: COSTO_SERVICIO_PENDIENTE,
    body: 'Para compartir tu ubicación al profesional, se requiere el pago del costo de servicio YaChanga.',
    showQuotedFee: true,
  };
}

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
