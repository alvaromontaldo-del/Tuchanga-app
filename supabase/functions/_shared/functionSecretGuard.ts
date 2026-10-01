import { providedFunctionSecret, secretsMatch } from "./functionSecret.ts";
import { resolveEdgeFunctionSecret } from "./secretResolver.ts";
import { json } from "./supabaseAdmin.ts";

/**
 * Secreto compartido de push_on_* y cleanup_chat_images.
 * Primero EDGE_FUNCTION_SECRET (alias de entorno CLEANUP_CRON_SECRET).
 * Si el entorno está vacío, Vault `edge_function_secret` vía
 * public.get_edge_function_secret, cacheado por isolate.
 * 503 si no hay secreto; 401 si el header falta o no coincide.
 */
export async function requireFunctionSecret(req: Request): Promise<Response | null> {
  const expected = await resolveEdgeFunctionSecret();
  if (!expected) {
    return json(503, { error: "function_secret_not_configured" });
  }
  const provided = providedFunctionSecret(req.headers);
  if (!secretsMatch(provided, expected)) {
    return json(401, { error: "unauthorized" });
  }
  return null;
}
