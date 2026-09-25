import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Tokens Expo únicos (trim + DISTINCT). */
export function uniqueExpoTokens(
  tokens: Array<string | null | undefined>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const t = String(raw ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Reserva event_key en push_delivery_log.
 * true = primera entrega (enviar); false = ya se envió / otro worker lo reclamó.
 */
export async function claimPushDelivery(
  sb: SupabaseClient,
  eventKey: string,
): Promise<boolean> {
  const key = String(eventKey ?? "").trim().slice(0, 240);
  if (!key) return false;

  const { data, error } = await sb.rpc("claim_push_delivery", {
    p_event_key: key,
  });

  if (!error) {
    return data === true;
  }

  // Fallback si la RPC aún no está desplegada: INSERT directo.
  const { error: insErr } = await sb.from("push_delivery_log").insert({
    event_key: key,
  });
  if (!insErr) return true;
  if (insErr.code === "23505") return false;
  console.warn("[claimPushDelivery]", insErr.message);
  // Ante error de infra, no enviar (mejor perder un push que duplicar).
  return false;
}
