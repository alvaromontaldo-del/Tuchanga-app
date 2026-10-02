import type { SignupRoleId } from '../constants/sessionRoles';
import { registerAuthTarget } from './registerEntry';

export type SignupRoleScreenOption = {
  id: SignupRoleId;
  title: string;
  description: string;
  icon: 'person-outline' | 'hammer-outline' | 'storefront-outline';
};

/** Las tres entradas del alta, con el texto de la pantalla nueva. */
export const SIGNUP_ROLE_SCREEN_OPTIONS: SignupRoleScreenOption[] = [
  {
    id: 'client',
    title: 'Cliente',
    description: 'Buscá y contratá profesionales',
    icon: 'person-outline',
  },
  {
    id: 'professional',
    title: 'Profesional',
    description: 'Ofrecé tus servicios',
    icon: 'hammer-outline',
  },
  {
    id: 'commerce',
    title: 'Comercio',
    description: 'Vendé materiales a profesionales',
    icon: 'storefront-outline',
  },
];

/**
 * Cada botón reutiliza el alta que ya existe (`Register` + params).
 * `redirectTo` se conserva si el login llegó desde un deep link.
 */
export function signupRoleRegisterTarget(
  role: SignupRoleId,
  redirectTo?: string,
): {
  screen: 'Register';
  params: { asCommerce: boolean; asProfessional?: boolean; redirectTo?: string };
} {
  const target = registerAuthTarget(role);
  return {
    screen: target.screen,
    params: {
      ...target.params,
      ...(redirectTo ? { redirectTo } : {}),
    },
  };
}
