import { createAdminClient } from "./supabaseAdmin.ts";

/**
 * Cache por isolate. La primera lectura exitosa de Vault queda fija
 * hasta que la instancia se recicla. Un error de red no se cachea.
 */
const vaultCache = new Map<string, string>();

function envValue(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

async function readVaultSecret(name: string): Promise<string> {
  const cached = vaultCache.get(name);
  if (cached !== undefined) return cached;

  try {
    const sb = createAdminClient();
    const { data, error } = await sb.rpc("get_edge_function_secret", {
      p_name: name,
    });
    if (error) return "";
    const value = typeof data === "string" ? data.trim() : "";
    vaultCache.set(name, value);
    return value;
  } catch {
    return "";
  }
}

/**
 * EDGE_FUNCTION_SECRET (alias CLEANUP_CRON_SECRET) y, si ambos están vacíos,
 * el secreto de Vault `edge_function_secret`.
 */
export async function resolveEdgeFunctionSecret(): Promise<string> {
  const fromEnv = envValue("EDGE_FUNCTION_SECRET") || envValue("CLEANUP_CRON_SECRET");
  if (fromEnv) return fromEnv;
  return readVaultSecret("edge_function_secret");
}

/**
 * MP_WEBHOOK_SECRET y, si está vacío, el secreto de Vault `mp_webhook_secret`.
 */
export async function resolveMpWebhookSecret(): Promise<string> {
  const fromEnv = envValue("MP_WEBHOOK_SECRET");
  if (fromEnv) return fromEnv;
  return readVaultSecret("mp_webhook_secret");
}
