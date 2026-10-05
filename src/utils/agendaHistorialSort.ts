import type { Contratacion } from '../types/contrataciones';

type HistorialRow = Pick<Contratacion, 'id' | 'fecha_trabajo' | 'hora_inicio' | 'created_at'>;

/**
 * Instante para ordenar el historial: la fecha del trabajo si existe,
 * y si no, created_at. Más grande = más reciente.
 */
export function historialRecienteInstant(row: HistorialRow): string {
  const fecha = (row.fecha_trabajo ?? '').trim();
  if (fecha) {
    const hora = (row.hora_inicio ?? '').trim().slice(0, 8) || '00:00:00';
    return `${fecha}T${hora}`;
  }
  return row.created_at ?? '';
}

/** Historial reciente: más nuevo primero (fecha o created_at, descendente). */
export function sortHistorialReciente<T extends HistorialRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byWhen = historialRecienteInstant(b).localeCompare(historialRecienteInstant(a));
    if (byWhen !== 0) return byWhen;
    const byCreated = String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
    if (byCreated !== 0) return byCreated;
    return String(b.id).localeCompare(String(a.id));
  });
}
