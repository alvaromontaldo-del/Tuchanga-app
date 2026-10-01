/**
 * Header del secreto de Edge (push_on_* y cleanup_chat_images).
 * No definas EXPO_PUBLIC_EDGE_FUNCTION_SECRET en la app publicada: el valor
 * quedaría en el bundle. En producción lo mandan los triggers (Vault) y el cron.
 */
export function edgeFunctionSecretHeaders(): Record<string, string> {
  const secret = (process.env.EXPO_PUBLIC_EDGE_FUNCTION_SECRET ?? '').trim();
  if (!secret) return {};
  return { 'x-function-secret': secret };
}
