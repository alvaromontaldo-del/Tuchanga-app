export type RegisterChoice = 'particular' | 'commerce';

/**
 * Alta desde "Registrate": Particular o Comercio van al formulario.
 * Comercio no pasa por la pantalla de ingreso.
 */
export function registerAuthTarget(choice: RegisterChoice): {
  screen: 'Register';
  params: { asCommerce: boolean };
} {
  return {
    screen: 'Register',
    params: { asCommerce: choice === 'commerce' },
  };
}
