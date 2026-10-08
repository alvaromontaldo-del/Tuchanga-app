import type { SessionRole } from '../context/commerceShellState';

/**
 * Orden de desempate cuando el rol actual no está definido.
 * No es el default de login ni de arranque en frío: eso sigue en
 * `defaultSessionRoleAfterLogin` (comercio > profesional > cliente).
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
 * Con local habilitado el cambio es entre particular y comercio:
 * - comercio → profesional si la cuenta es trabajador, si no cliente;
 * - profesional o cliente → comercio.
 * Sin local habilitado se mantiene profesional ↔ cliente.
 * Un solo rol: null (no hay botón).
 */
export function nextSessionRoleOnSwitch(
  current: SessionRole | null,
  available: readonly SessionRole[],
): SessionRole | null {
  const ordered = SESSION_ROLE_SWITCH_ORDER.filter((role) => available.includes(role));
  if (ordered.length < 2) return null;

  const hasCommerce = ordered.includes('commerce');
  if (!hasCommerce) {
    if (current && ordered.includes(current)) {
      return ordered.find((role) => role !== current) ?? null;
    }
    return ordered[0] ?? null;
  }

  if (current === 'commerce') {
    return ordered.includes('professional') ? 'professional' : 'client';
  }
  if (current === 'professional' || current === 'client') {
    return 'commerce';
  }

  return ordered[0] ?? null;
}

/**
 * Con comercio el botón dice a dónde va (comercio o particular).
 * Sin comercio sigue el texto de hoy: «Cambiar de rol» y el destino concreto.
 */
export function sessionRoleSwitchButtonCopy(
  next: SessionRole,
  available: readonly SessionRole[],
): { title: string; subtitle: string } {
  const destination = sessionRoleSwitchLabel(next);
  if (!available.includes('commerce')) {
    return {
      title: 'Cambiar de rol',
      subtitle: `Pasar a ${destination}`,
    };
  }
  if (next === 'commerce') {
    return {
      title: 'Cambiar a Comercio',
      subtitle: 'Pasar a Comercio',
    };
  }
  return {
    title: 'Cambiar a Particular',
    subtitle: `Pasar a ${destination}`,
  };
}
