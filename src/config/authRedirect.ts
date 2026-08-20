/**
 * URL de retorno para emails de Auth (recuperación de contraseña).
 * Debe coincidir con Authentication → URL configuration en Supabase.
 */
export const AUTH_APP_SCHEME = 'tuchanga-app';

/** Deep link que abre la app en el flujo de nueva contraseña. */
export function getPasswordRecoveryRedirectUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL ?? '').trim();
  if (fromEnv) return fromEnv;
  return `${AUTH_APP_SCHEME}://reset-password`;
}

/** URLs a registrar en Supabase → Redirect URLs (ver supabase/RECUPERAR_CONTRASENA.md). */
export const SUPABASE_REDIRECT_URLS = [
  `${AUTH_APP_SCHEME}://reset-password`,
  `${AUTH_APP_SCHEME}://**`,
  'exp+tuchanga-app://reset-password',
  'exp+tuchanga-app://**',
] as const;
