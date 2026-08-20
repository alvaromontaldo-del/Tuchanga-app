/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendExpoPush } from "../_shared/expoPush.ts";

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
        "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "missing_env", need: ["SUPABASE_URL", "SERVICE_ROLE_KEY"] });
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

  if ("record" in payload && payload.record?.store_id) {
    if (payload.type && payload.type !== "INSERT") {
      return json(200, { ok: true, ignored: true });
    }
    const ev = payload.record;
    storeId = ev.store_id;
    title = ev.title || title;
    body = ev.body || body;
    data = { type: "store_board", eventType: ev.event_type, ...(ev.data ?? {}) };
  } else {
    const direct = payload as DirectBody;
    storeId = (direct.store_id ?? "").trim();
    title = direct.title?.trim() || title;
    body = direct.body?.trim() || body;
    data = { type: "store_board", ...(direct.data ?? {}) };
  }

  if (!storeId) return json(400, { error: "missing_store_id" });

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

  if (pe || !prof?.expo_push_token) {
    return json(200, { ok: true, skipped: "no_push_token" });
  }

  try {
    await sendExpoPush({
      to: prof.expo_push_token,
      title,
      body,
      data: { ...data, storeId },
    });
  } catch (e) {
    return json(200, { ok: true, skipped: "expo_error", detail: String(e) });
  }

  return json(200, { ok: true });
});
