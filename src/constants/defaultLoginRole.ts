import type { SessionRole } from '../context/commerceShellState';

export type DefaultLoginRoleInput = {
  /**
   * Comercio ya habilitado (trial, active, unpaid o paused).
   * Un alta solo pendiente no entra al módulo: en Android el atrás del shell cierra la app.
   */
  hasEnabledCommerce: boolean;
  /** Oficios con radio de cobertura, el mismo criterio que el modo profesional. */
  isWorker: boolean;
};

/**
 * Vista inicial después de ingresar. Gana el rol más alto:
 * Comercio, después Profesional, si no Cliente.
 */
export function defaultSessionRoleAfterLogin(input: DefaultLoginRoleInput): SessionRole {
  if (input.hasEnabledCommerce) return 'commerce';
  if (input.isWorker) return 'professional';
  return 'client';
}

/** Trabajador según el usuario que devolvió el login (jobs + cobertura). */
export function isWorkerAuthUser(
  user:
    | {
        worker?: { trades?: readonly unknown[] | null; coverageKm?: number | null } | null;
      }
    | null
    | undefined,
): boolean {
  const trades = user?.worker?.trades;
  const km = user?.worker?.coverageKm ?? 0;
  return Boolean(trades && trades.length > 0 && km > 0);
}

export type LoginAuthDismiss = 'close' | 'redirect' | 'inicio';

/**
 * Comercio es su propia ruta raíz. Hay que usar `closeAuthModal()` y dejar
 * que el shell abra `Commerce`. Ir a Inicio pelea con ese cambio.
 */
export function loginAuthDismiss(params: {
  role: SessionRole;
  redirectTo?: string;
}): LoginAuthDismiss {
  if (params.role === 'commerce') return 'close';
  if (params.redirectTo) return 'redirect';
  return 'inicio';
}
