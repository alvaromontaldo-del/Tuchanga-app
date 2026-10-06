import type { SessionRole } from '../context/commerceShellState';

/**
 * Orden del botón «Cambiar de rol». No es el default de login ni de arranque
 * en frío: eso sigue en `defaultSessionRoleAfterLogin` (comercio > profesional > cliente).
 */
export const SESSION_ROLE_SWITCH_ORDER = ['commerce', 'professional', 'client'] as const;

const ROLE_LABEL: Record<SessionRole, string> = {
  commerce: 'Comercio',
  professional: 'Profesional',
  client: 'Cliente',
};

export function sessionRoleSwitchLabel(role: SessionRole): string {
  return ROLE_LABEL[role];
}

/**
 * Roles a los que esta cuenta puede entrar sin el selector.
 * Cliente siempre cuenta. Profesional si la UI ya lo trata como trabajador.
 * Comercio solo con local habilitado (no el alta pendiente).
 */
export function availableSessionRoles(input: {
  hasEnabledCommerce: boolean;
  isProfessional: boolean;
}): SessionRole[] {
  const enabled: Record<SessionRole, boolean> = {
    commerce: input.hasEnabledCommerce,
    professional: input.isProfessional,
    client: true,
  };
  return SESSION_ROLE_SWITCH_ORDER.filter((role) => enabled[role]);
}

/**
 * Un toque, sin «¿Cómo querés ingresar?».
 * - Un rol: null (ocultar el botón).
 * - Dos: el otro.
 * - Tres: el siguiente del anillo comercio → profesional → cliente → comercio.
 * Si falta un rol, se salta y sigue el mismo orden entre los que sí tiene.
 */
export function nextSessionRoleOnSwitch(
  current: SessionRole | null,
  available: readonly SessionRole[],
): SessionRole | null {
  const ordered = SESSION_ROLE_SWITCH_ORDER.filter((role) => available.includes(role));
  if (ordered.length < 2) return null;

  if (current && ordered.includes(current)) {
    if (ordered.length === 2) {
      return ordered.find((role) => role !== current) ?? null;
    }
    const index = ordered.indexOf(current);
    return ordered[(index + 1) % ordered.length];
  }

  return ordered[0] ?? null;
}
