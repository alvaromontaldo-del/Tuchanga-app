/// <reference lib="deno.ns" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendExpoPush } from "../_shared/expoPush.ts";

type WebhookPayload<T> = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: T;
  old_record: T | null;
};

type ReviewRow = {
  id: string;
  conversation_id: string;
  worker_id: string;
  client_id: string;
  job_id?: string | null;
  rating: number;
  comment?: string | null;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "missing_env", need: ["SUPABASE_URL", "SERVICE_ROLE_KEY"] });
  }

  let payload: WebhookPayload<ReviewRow>;
  try {
    payload = (await req.json()) as WebhookPayload<ReviewRow>;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const review = payload?.record;
  if (!review?.worker_id) {
    return json(400, { error: "missing_review_fields" });
  }

  if (payload.type && payload.type !== "INSERT") {
    return json(200, { ok: true, ignored: true });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: prof, error: pe } = await sb
    .from("profiles")
    .select("expo_push_token,nombre,apellido")
    .eq("id", review.worker_id)
    .maybeSingle();

  if (pe || !prof?.expo_push_token) {
    return json(200, { ok: true, skipped: "no_push_token" });
  }

  let clientId = review.client_id;
  if (!clientId && review.conversation_id) {
    const { data: conv } = await sb
      .from("conversations")
      .select("cliente_id")
      .eq("id", review.conversation_id)
      .maybeSingle();
    clientId = (conv as { cliente_id?: string } | null)?.cliente_id ?? "";
  }

  const { data: clientProf } = clientId
    ? await sb.from("profiles").select("nombre,apellido").eq("id", clientId).maybeSingle()
    : { data: null };

  const clientNameRaw = clientProf
    ? `${clientProf.nombre ?? ""} ${clientProf.apellido ?? ""}`.trim()
    : "Un cliente";
  const clientName = clientNameRaw.split(/\s+/).filter(Boolean)[0] ?? "Un cliente";
  const stars = Math.max(1, Math.min(5, Math.round(Number(review.rating) || 5)));

  try {
    await sendExpoPush({
      to: prof.expo_push_token,
      title: "YaChanga",
      body: `${clientName} te dejó una reseña de ${stars} estrellas.`,
      data: {
        conversationId: review.conversation_id ?? null,
        jobId: review.job_id ?? null,
        reviewId: review.id,
        type: "worker_review",
      },
    });
  } catch (e) {
    return json(200, { ok: true, skipped: "expo_error", detail: String(e) });
  }

  return json(200, { ok: true });
});
