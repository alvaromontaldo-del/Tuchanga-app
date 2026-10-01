import type { SessionRole } from '../context/commerceShellState';

export type SignupRoleId = 'client' | 'professional' | 'commerce';

export type SignupRoleOption = {
  id: SignupRoleId;
  title: string;
  description: string;
  icon: 'person-outline' | 'hammer-outline' | 'storefront-outline';
};

/** Las tres entradas visibles. Sin opción de testing. */
export const SIGNUP_ROLE_OPTIONS: SignupRoleOption[] = [
  {
    id: 'client',
    title: 'Cliente',
    description: 'Contratá trabajos y chateá con profesionales.',
    icon: 'person-outline',
  },
  {
    id: 'professional',
    title: 'Profesional',
    description: 'Ofrecé tus oficios, cotizá y gestioná tu agenda.',
    icon: 'hammer-outline',
  },
  {
    id: 'commerce',
    title: 'Comercio',
    description: 'Recibí pedidos de materiales y enviá cotizaciones.',
    icon: 'storefront-outline',
  },
];

/** Rol de sesión ya autenticada. Cliente y profesional no entran al módulo comercio. */
export function sessionRoleForSignup(role: SignupRoleId): SessionRole {
  if (role === 'commerce') return 'commerce';
  if (role === 'professional') return 'professional';
  return 'client';
}
