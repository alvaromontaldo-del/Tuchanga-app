export type RegisterChoice = 'particular' | 'client' | 'professional' | 'commerce';

/**
 * Alta desde "Registrate".
 * Cliente y profesional van al formulario de persona (`asCommerce: false`).
 * Profesional abre ese mismo formulario con los oficios ya activos.
 * Comercio no pasa por la pantalla de ingreso.
 */
export function registerAuthTarget(choice: RegisterChoice): {
  screen: 'Register';
  params: { asCommerce: boolean; asProfessional?: boolean };
} {
  if (choice === 'commerce') {
    return {
      screen: 'Register',
      params: { asCommerce: true },
    };
  }
  if (choice === 'professional') {
    return {
      screen: 'Register',
      params: { asCommerce: false, asProfessional: true },
    };
  }
  return {
    screen: 'Register',
    params: { asCommerce: false },
  };
}
