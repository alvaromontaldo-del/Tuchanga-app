/**
 * Cliente y Profesional viven en `Main` (tabs). Comercio vive en `Commerce` (stack).
 * No se puede cambiar de shell montando el otro navigator dentro de la misma ruta:
 * el state anidado queda `stale: false` con el tipo del navigator anterior
 * (tabs sin `preloadedRoutes`, o stack sin `preloadedRouteKeys`). El primer render
 * revienta y el error boundary lo muestra; Reintentar remonta el árbol vacío y por
 * eso el módulo aparecía recién al segundo intento.
 */

export type ShellRouteName = 'Main' | 'Commerce';

const PRESERVE_FOCUSED_ROUTES = new Set(['AuthModal', 'PagoCheckout', 'PagoRetorno']);

export function shellRouteName(isCommerceShell: boolean): ShellRouteName {
  return isCommerceShell ? 'Commerce' : 'Main';
}

export function focusedRouteName(
  state: { index?: number; routes?: { name?: string }[] } | undefined,
): string | undefined {
  if (!state?.routes?.length) return undefined;
  const index = state.index ?? 0;
  return state.routes[index]?.name;
}

/**
 * Ruta raíz a la que hay que ir, o null si el foco ya es el shell correcto
 * o si hay que dejar quieto login, checkout o un árbol que todavía carga.
 */
export function shellRedirectTarget(params: {
  isAuthed: boolean;
  shellLoading: boolean;
  isCommerceShell: boolean;
  focusedRouteName: string | undefined;
}): ShellRouteName | null {
  if (!params.isAuthed || params.shellLoading) return null;
  if (params.focusedRouteName && PRESERVE_FOCUSED_ROUTES.has(params.focusedRouteName)) {
    return null;
  }
  const target = shellRouteName(params.isCommerceShell);
  if (params.focusedRouteName === target) return null;
  return target;
}

/** Reset sin `state` anidado: el shell nuevo no hereda rutas del anterior. */
export function shellResetState(target: ShellRouteName): {
  index: number;
  routes: { name: ShellRouteName }[];
} {
  return { index: 0, routes: [{ name: target }] };
}
