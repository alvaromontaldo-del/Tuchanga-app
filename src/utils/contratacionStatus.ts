import type {
  Contratacion,
  ContratacionEstadoPago,
  ContratacionEstadoTrabajo,
} from '../types/contrataciones';

export function localDateIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatContratacionEstadoPago(estado: ContratacionEstadoPago): string {
  const labels: Record<ContratacionEstadoPago, string> = {
    pendiente_seña: 'Costo de servicio pendiente',
    seña_pagada: 'Costo de servicio pagado',
    totalmente_pagado: 'Trabajo pagado',
  };
  return labels[estado] ?? estado;
}

export function formatContratacionEstado(estado: ContratacionEstadoTrabajo): string {
  const labels: Record<ContratacionEstadoTrabajo, string> = {
    pendiente: 'Pendiente',
    precio_cotizado: 'Precio cotizado',
    precio_aceptado: 'Precio aceptado',
    aceptado: 'Agenda confirmada',
    en_curso: 'En curso',
    pendiente_pago_diferencia: 'Recotización pendiente',
    pendiente_conformidad: 'Conformidad pendiente',
    finalizado: 'Finalizado',
    cancelado: 'Cancelado',
    disputa: 'En disputa',
  };
  return labels[estado] ?? estado;
}

/** Trabajo agendado con seña pagada y fecha confirmada (hoy o futuro). */
export function isAgendaProgramada(c: Contratacion): boolean {
  if (!c.fecha_trabajo) return false;
  if (c.estado_pago === 'pendiente_seña') return false;
  return c.estado_trabajo === 'aceptado' || c.estado_trabajo === 'en_curso';
}

export function isAgendaDelDia(c: Contratacion, dateIso: string): boolean {
  return isAgendaProgramada(c) && c.fecha_trabajo === dateIso;
}

export function isAgendaFutura(c: Contratacion, todayIso: string): boolean {
  return isAgendaProgramada(c) && c.fecha_trabajo! > todayIso;
}

export function isHistorialContratacion(c: Contratacion): boolean {
  return (
    c.estado_trabajo === 'finalizado' ||
    c.estado_trabajo === 'cancelado' ||
    c.estado_trabajo === 'disputa'
  );
}

/** Trabajo iniciado (PIN validado) o posterior: el cliente puede notificar el saldo offline. */
export const ESTADOS_PUEDEN_NOTIFICAR_SALDO: ContratacionEstadoTrabajo[] = [
  'en_curso',
  'pendiente_conformidad',
  'finalizado',
  'pendiente_pago_diferencia',
  'disputa',
];

export function puedeNotificarSaldoOffline(c: {
  estado_trabajo: ContratacionEstadoTrabajo;
  estado_pago: ContratacionEstadoPago;
  offline_pago_notificado_at: string | null;
  precio_final: number;
  comision_app: number;
}): boolean {
  if (c.estado_pago !== 'seña_pagada') return false;
  if (c.offline_pago_notificado_at) return false;
  if (!ESTADOS_PUEDEN_NOTIFICAR_SALDO.includes(c.estado_trabajo)) return false;
  return c.precio_final - c.comision_app > 0;
}

export function canShowVerServicioLink(c: Contratacion): boolean {
  if (c.estado_trabajo === 'cancelado') return false;
  if (c.estado_trabajo === 'precio_cotizado') return true;
  if (c.estado_trabajo === 'precio_aceptado') return true;
  return c.fecha_trabajo != null || c.estado_trabajo === 'aceptado' || c.estado_trabajo === 'en_curso';
}

export function formatAgendaHorario(
  c: Contratacion,
  opts?: { includeDate?: boolean },
): string {
  const includeDate = opts?.includeDate !== false;
  const time =
    c.hora_inicio && c.hora_fin
      ? `${String(c.hora_inicio).slice(0, 5)} – ${String(c.hora_fin).slice(0, 5)}`
      : null;

  if (!includeDate) {
    return time ?? 'Sin horario';
  }

  if (!c.fecha_trabajo) return 'Sin fecha';
  const parts = [c.fecha_trabajo.split('-').reverse().join('/')];
  if (time) parts.push(time);
  return parts.join(' · ');
}
