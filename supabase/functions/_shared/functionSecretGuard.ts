import { providedFunctionSecret, secretsMatch } from "./functionSecret.ts";
import { json } from "./supabaseAdmin.ts";

/**
 * Secreto compartido de push_on_* y cleanup_chat_images.
 * EDGE_FUNCTION_SECRET es el nombre canónico. CLEANUP_CRON_SECRET se acepta
 * si el canónico no está, para no cortar un cron que ya lo tenía.
 * 503 si no hay secreto configurado; 401 si el header falta o no coincide.
 */
export function requireFunctionSecret(req: Request): Response | null {
  const expected = (
    Deno.env.get("EDGE_FUNCTION_SECRET") ??
    Deno.env.get("CLEANUP_CRON_SECRET") ??
    ""
  ).trim();
  if (!expected) {
    return json(503, { error: "function_secret_not_configured" });
  }
  const provided = providedFunctionSecret(req.headers);
  if (!secretsMatch(provided, expected)) {
    return json(401, { error: "unauthorized" });
  }
  return null;
}
