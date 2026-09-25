/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendExpoPush } from "../_shared/expoPush.ts";
import {
  claimPushDelivery,
  uniqueExpoTokens,
} from "../_shared/pushIdempotency.ts";

type WebhookPayload<T> = {
  type?: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  schema?: string;
  record: T;
  old_record?: T | null;
};

type StorePushEvent = {
  id: string;
  store_id: string;
  event_type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
};

type DirectBody = {
  store_id?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  /** Clave opcional de idempotencia para invokes directos. */
  idempotency_key?: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

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

  let payload: WebhookPayload<StorePushEvent> | DirectBody;
  try {
    payload = (await req.json()) as WebhookPayload<StorePushEvent> | DirectBody;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let storeId = "";
  let title = "YaChanga";
  let body = "Actualización de pedido";
  let data: Record<string, unknown> = { type: "store_board" };
  let eventKey = "";

  if ("record" in payload && payload.record?.store_id) {
    if (payload.type && payload.type !== "INSERT") {
      return json(200, { ok: true, ignored: true });
    }
    const ev = payload.record;
    storeId = ev.store_id;
    title = ev.title || title;
    body = ev.body || body;
    data = { type: "store_board", eventType: ev.event_type, ...(ev.data ?? {}) };
    eventKey = `store_push:${ev.id}`;
  } else {
    const direct = payload as DirectBody;
    storeId = (direct.store_id ?? "").trim();
    title = direct.title?.trim() || title;
    body = direct.body?.trim() || body;
    data = { type: "store_board", ...(direct.data ?? {}) };
    const custom = String(direct.idempotency_key ?? "").trim();
    eventKey =
      custom ||
      `store_direct:${storeId}:${String(data.eventType ?? data.column ?? "board")}:${String(
        data.requestId ?? data.orderId ?? data.targetId ?? title,
      )}`;
  }

  if (!storeId) return json(400, { error: "missing_store_id" });

  if (!(await claimPushDelivery(sb, eventKey))) {
    return json(200, { ok: true, skipped: "already_sent", eventKey });
  }

  const { data: store, error: se } = await sb
    .from("stores")
    .select("id, user_id, name")
    .eq("id", storeId)
    .maybeSingle();

  if (se || !store?.user_id) {
    return json(200, { ok: true, skipped: "store_not_found" });
  }

  const { data: prof, error: pe } = await sb
    .from("profiles")
    .select("expo_push_token")
    .eq("id", store.user_id)
    .maybeSingle();

  const tokens = uniqueExpoTokens([prof?.expo_push_token]);
  if (pe || tokens.length === 0) {
    return json(200, { ok: true, skipped: "no_push_token" });
  }

  try {
    await sendExpoPush({
      to: tokens,
      title,
      body,
      data: { ...data, storeId },
    });
  } catch (e) {
    return json(200, { ok: true, skipped: "expo_error", detail: String(e) });
  }

  return json(200, { ok: true });
});
