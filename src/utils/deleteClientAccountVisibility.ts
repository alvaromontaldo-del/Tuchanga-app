import type { SessionRole } from '../context/commerceShellState';

/**
 * El botón «Eliminar cuenta» vive solo en Modificar datos del cliente.
 * Profesional ya tiene «Dar de baja» y comercio su propio módulo: no mezclarlos.
 */
export function showDeleteClientAccountButton(input: {
  sessionRole: SessionRole | null;
  isWorker: boolean;
  isCommerceShell: boolean;
}): boolean {
  if (input.isCommerceShell) return false;
  if (input.sessionRole === 'professional' || input.sessionRole === 'commerce') return false;
  if (input.isWorker) return false;
  return true;
}
