/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";

type WebhookPayload<T> = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: T;
  old_record: T | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at?: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sendExpoPush(params: {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      to: params.to,
      title: params.title,
      body: params.body,
      data: params.data ?? {},
      sound: "default",
      priority: "high",
    }),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`expo_push_failed:${res.status}:${txt}`);
  }
  return txt;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "missing_env", need: ["SUPABASE_URL", "SERVICE_ROLE_KEY"] });
  }

  let payload: WebhookPayload<MessageRow>;
  try {
    payload = (await req.json()) as WebhookPayload<MessageRow>;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const msg = payload?.record;
  if (!msg?.conversation_id || !msg?.sender_id) {
    return json(400, { error: "missing_message_fields" });
  }

  // Solo INSERT
  if (payload.type && payload.type !== "INSERT") {
    return json(200, { ok: true, ignored: true });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // Resolver destinatario mirando la conversación.
  const { data: conv, error: ce } = await sb
    .from("conversations")
    .select("id,cliente_id,trabajador_id")
    .eq("id", msg.conversation_id)
    .maybeSingle();

  if (ce || !conv) {
    return json(200, { ok: true, skipped: "conversation_not_found" });
  }

  const sender = msg.sender_id;
  const recipient =
    conv.cliente_id === sender ? conv.trabajador_id : conv.trabajador_id === sender ? conv.cliente_id : null;

  if (!recipient) {
    return json(200, { ok: true, skipped: "sender_not_participant" });
  }

  // Buscar token del receptor.
  const { data: prof, error: pe } = await sb
    .from("profiles")
    .select("expo_push_token,nombre,apellido")
    .eq("id", recipient)
    .maybeSingle();

  if (pe || !prof?.expo_push_token) {
    return json(200, { ok: true, skipped: "no_push_token" });
  }

  const senderProfile = await sb
    .from("profiles")
    .select("nombre,apellido")
    .eq("id", sender)
    .maybeSingle();

  const senderNameRaw = senderProfile.data
    ? `${senderProfile.data.nombre ?? ""} ${senderProfile.data.apellido ?? ""}`.trim()
    : "Nuevo mensaje";
  const senderName = senderNameRaw.split(/\s+/).filter(Boolean)[0] ?? "Nuevo mensaje";

  const body = (msg.body ?? "").trim().slice(0, 180) || "Nuevo mensaje";

  try {
    await sendExpoPush({
      to: prof.expo_push_token,
      title: senderName,
      body,
      data: {
        conversationId: msg.conversation_id,
        messageId: msg.id,
        senderId: msg.sender_id,
      },
    });
  } catch (e) {
    return json(200, { ok: true, skipped: "expo_error", detail: String(e) });
  }

  return json(200, { ok: true });
});

