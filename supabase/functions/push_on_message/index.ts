/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendExpoPush } from "../_shared/expoPush.ts";
import { requireFunctionSecret } from "../_shared/functionSecretGuard.ts";
import {
  claimPushDelivery,
  uniqueExpoTokens,
} from "../_shared/pushIdempotency.ts";

type WebhookPayload<T> = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: T;
  old_record: T | null;
};

type MessageMeta = {
  audience?: string;
  event?: string;
  diferencia?: number;
  tipo_pago?: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  type?: string;
  metadata?: MessageMeta | string | null;
  created_at?: string;
};

function firstNameFromProfile(
  profile: { nombre?: string | null; apellido?: string | null } | null,
  fallback: string,
): string {
  const raw = profile
    ? `${profile.nombre ?? ""} ${profile.apellido ?? ""}`.trim()
    : "";
  return raw.split(/\s+/).filter(Boolean)[0] ?? fallback;
}

/** Push que ve el cliente: solo el nombre del profesional, sin apellido ni inicial. */
function givenNameForClient(nombre: string | null | undefined, fallback: string): string {
  const s = (nombre ?? "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return fallback;
  const withoutInitial = s.replace(/\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]\.?$/u, "").trim();
  return withoutInitial || fallback;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

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

  // Solo INSERT (updates no re-disparan push).
  if (payload.type && payload.type !== "INSERT") {
    return json(200, { ok: true, ignored: true });
  }

  let meta: MessageMeta | null = null;
  if (msg.metadata && typeof msg.metadata === "object") {
    meta = msg.metadata;
  } else if (typeof msg.metadata === "string") {
    try {
      meta = JSON.parse(msg.metadata) as MessageMeta;
    } catch {
      meta = null;
    }
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const eventKey = `message:${msg.id}`;
  if (!(await claimPushDelivery(sb, eventKey))) {
    return json(200, { ok: true, skipped: "already_sent", eventKey });
  }

  const { data: conv, error: ce } = await sb
    .from("conversations")
    .select("id,cliente_id,trabajador_id")
    .eq("id", msg.conversation_id)
    .maybeSingle();

  if (ce || !conv) {
    return json(200, { ok: true, skipped: "conversation_not_found" });
  }

  const sender = msg.sender_id;
  const audience =
    msg.type === "system" && typeof meta?.audience === "string"
      ? meta.audience
      : null;

  let recipient: string | null = null;
  if (audience === "cliente") {
    recipient = conv.cliente_id;
  } else if (audience === "trabajador") {
    recipient = conv.trabajador_id;
  } else {
    recipient =
      conv.cliente_id === sender
        ? conv.trabajador_id
        : conv.trabajador_id === sender
          ? conv.cliente_id
          : null;
  }

  if (!recipient) {
    return json(200, { ok: true, skipped: "no_recipient" });
  }

  if (!audience && recipient === sender) {
    return json(200, { ok: true, skipped: "same_sender_recipient" });
  }

  const { data: prof, error: pe } = await sb
    .from("profiles")
    .select("expo_push_token")
    .eq("id", recipient)
    .maybeSingle();

  const tokens = uniqueExpoTokens([prof?.expo_push_token]);
  if (pe || tokens.length === 0) {
    return json(200, { ok: true, skipped: "no_push_token" });
  }

  let title = "Nuevo mensaje";
  if (msg.type === "system" && audience) {
    title = "YaChanga";
  } else {
    const notifyingClient = recipient === conv.cliente_id;
    const senderProfile = await sb
      .from("profiles")
      .select(notifyingClient ? "nombre" : "nombre,apellido")
      .eq("id", sender)
      .maybeSingle();
    title = notifyingClient
      ? givenNameForClient(senderProfile.data?.nombre, "Nuevo mensaje")
      : firstNameFromProfile(senderProfile.data, "Nuevo mensaje");
  }

  const event =
    msg.type === "system" && typeof meta?.event === "string"
      ? meta.event
      : null;

  let body = (msg.body ?? "").trim().slice(0, 180) || "Nuevo mensaje";
  if (event === "trabajo_finalizado") {
    if (audience !== "cliente") {
      return json(200, { ok: true, skipped: "trabajo_finalizado_not_for_worker" });
    }
    body =
      "El profesional marcó el trabajo como finalizado. Podés dejar tu reseña.";
  } else if (event === "seña_pagada_trabajador") {
    body = meta?.tipo_pago === "diferencia_seña"
      ? "El cliente pagó la diferencia del costo de servicio. Ya podés marcar el trabajo como realizado."
      : "El costo de servicio YaChanga fue pagado. Revisá el chat para coordinar la visita.";
  } else if (event === "seña_pagada_cliente") {
    body = meta?.tipo_pago === "diferencia_seña"
      ? "Pagaste la diferencia del costo de servicio YaChanga. El trabajo sigue en curso."
      : "Tu costo de servicio YaChanga fue acreditado.";
  } else if (event === "saldo_pagado_trabajador") {
    body =
      "El cliente indicó que pagó el saldo. Confirmá la recepción del pago en el chat.";
  } else if (event === "saldo_pagado_cliente") {
    body =
      "Indicaste que pagaste el saldo. Aguardá la confirmación del profesional.";
  } else if (event === "saldo_confirmado_cliente") {
    body = "El profesional confirmó que recibió el pago del saldo.";
  } else if (event === "saldo_confirmado_trabajador") {
    body = "Confirmaste la recepción del saldo. El trabajo quedó pagado.";
  } else if (event === "recotizacion_propuesta") {
    body = "El profesional propuso un nuevo monto. Aceptalo o rechazalo en el chat.";
  } else if (event === "recotizacion_propuesta_trabajador") {
    body = "Enviaste una recotización. El cliente tiene que aceptarla o rechazarla.";
  } else if (event === "recotizacion_aceptada") {
    const diff = Number(meta?.diferencia ?? 0);
    body = audience === "trabajador"
      ? "El cliente aceptó la recotización. El trabajo sigue con el monto nuevo."
      : diff > 0
        ? "Aceptaste la recotización. Falta pagar la diferencia del costo de servicio YaChanga."
        : "Aceptaste la recotización. El trabajo sigue con el monto nuevo.";
  } else if (event === "recotizacion_rechazada") {
    body = audience === "trabajador"
      ? "El cliente rechazó la recotización. El trabajo sigue con el monto original."
      : "Rechazaste la recotización. El trabajo sigue con el monto original.";
  } else if (event === "precio_aceptado_trabajador") {
    const { data: clientProf } = await sb
      .from("profiles")
      .select("nombre,apellido")
      .eq("id", conv.cliente_id)
      .maybeSingle();
    const clientName = firstNameFromProfile(clientProf, "el cliente");
    body = `Enviá a ${clientName} hasta 5 opciones para coordinar la visita.`;
  }

  try {
    await sendExpoPush({
      to: tokens,
      title,
      body,
      data: {
        conversationId: msg.conversation_id,
        messageId: msg.id,
        senderId: msg.sender_id,
        event,
      },
    });
  } catch (e) {
    return json(200, { ok: true, skipped: "expo_error", detail: String(e) });
  }

  return json(200, { ok: true });
});
