/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendExpoPush } from "../_shared/expoPush.ts";
import { requireFunctionSecret } from "../_shared/functionSecretGuard.ts";
import {
  claimPushDelivery,
  uniqueExpoTokens,
} from "../_shared/pushIdempotency.ts";

type RecordBody = {
  user_id?: string;
  asunto?: string;
  event_key?: string;
};

type WebhookBody = {
  type?: string;
  table?: string;
  schema?: string;
  record?: RecordBody;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * #110. Push al profesional cuando el admin rechaza el certificado.
 * El cuerpo es el asunto. No manda la ruta del archivo ni un apellido.
 * Autentica con x-function-secret (Vault), igual que los otros push.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const denied = await requireFunctionSecret(req);
  if (denied) return denied;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE =
    Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, {
      error: "missing_env",
      need: ["SUPABASE_URL", "SERVICE_ROLE_KEY"],
    });
  }

  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const record = body?.record ?? {};
  const userId = String(record.user_id ?? "").trim();
  const asunto = String(record.asunto ?? "").replace(/\s+/g, " ").trim();
  const eventKey = String(record.event_key ?? `antecedentes:${userId}`).trim().slice(0, 240);

  if (!userId || !asunto) {
    return json(400, { error: "missing_fields" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  if (!(await claimPushDelivery(sb, eventKey))) {
    return json(200, { ok: true, skipped: "already_sent", eventKey });
  }

  const { data: prof, error: pe } = await sb
    .from("profiles")
    .select("expo_push_token")
    .eq("id", userId)
    .maybeSingle();

  const tokens = uniqueExpoTokens([prof?.expo_push_token]);
  if (pe || tokens.length === 0) {
    return json(200, { ok: true, skipped: "no_push_token" });
  }

  try {
    await sendExpoPush({
      to: tokens,
      title: "YaChanga",
      body: asunto,
      data: { type: "antecedentes_penales" },
    });
  } catch (e) {
    return json(200, { ok: true, skipped: "expo_error", detail: String(e) });
  }

  return json(200, { ok: true });
});
