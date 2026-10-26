/// <reference lib="deno.ns" />

import { requireAuthenticatedUser } from "../_shared/requireUser.ts";
import { createAdminClient, json } from "../_shared/supabaseAdmin.ts";
import { getMpAccessToken, isMpSandboxMode } from "../_shared/mercadopago.ts";

type StoreRow = {
  id: string;
  user_id: string;
  status: string;
  trial_ends_at: string | null;
  category: string | null;
};

type PreapprovalResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
};

const CATEGORY_MISSING = "Todavía no tenés una categoría asignada.";
const FEE_MISSING = "Todavía no hay un precio cargado para tu categoría.";

function subscriptionChargeStartsAt(trialEndsAt: string | null, now = new Date()): Date {
  const end = trialEndsAt ? new Date(trialEndsAt) : null;
  if (end && !Number.isNaN(end.getTime()) && end.getTime() > now.getTime() + 60_000) {
    return end;
  }
  return new Date(now.getTime() + 10 * 60 * 1000);
}

/** Argentina es UTC−3 todo el año. MP pide la fecha con offset. */
function formatArgentinaIso(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}.000-03:00`;
}

function backUrl(): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/mp_retorno?yc_status=approved&store_subscription=1`;
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

  const token = getMpAccessToken();
  if (!token) return json(503, { error: "mp_not_configured", message: "Mercado Pago no está configurado." });
  if (!isMpSandboxMode(token)) {
    return json(403, {
      error: "mp_live_disabled",
      message: "Mercado Pago está habilitado solo en modo prueba.",
    });
  }

  let body: { store_id?: string };
  try {
    body = (await req.json()) as { store_id?: string };
  } catch {
    return json(400, { error: "invalid_json", message: "No se pudo leer el pedido." });
  }

  const storeId = (body.store_id ?? "").trim();
  if (!storeId) return json(400, { error: "store_required", message: "Falta el comercio." });

  const auth = await requireAuthenticatedUser(req);
  if (auth instanceof Response) return auth;

  const sb = createAdminClient();
  const { data: store, error: storeError } = await sb
    .from("stores")
    .select("id, user_id, status, trial_ends_at, category")
    .eq("id", storeId)
    .maybeSingle();
  if (storeError || !store) {
    return json(404, { error: "store_not_found", message: "No encontramos el comercio." });
  }
  const row = store as StoreRow;
  if (row.user_id !== auth.userId) {
    return json(403, { error: "forbidden", message: "Ese comercio no es tuyo." });
  }
  if (row.status === "pending_approval" || row.status === "rejected") {
    return json(422, {
      error: "store_not_approved",
      message: "Cuando aprobemos tu comercio vas a poder configurar el débito.",
    });
  }
  if (!row.category) {
    return json(422, { error: "category_missing", message: CATEGORY_MISSING });
  }

  const { data: category, error: feeError } = await sb
    .from("store_categories")
    .select("monthly_fee")
    .eq("code", row.category)
    .maybeSingle();
  const fee = Number((category as { monthly_fee?: number | string | null } | null)?.monthly_fee);
  if (feeError || !category || !Number.isFinite(fee) || fee <= 0) {
    return json(422, { error: "category_missing", message: FEE_MISSING });
  }

  const { data: userRow } = await sb.auth.admin.getUserById(auth.userId);
  const sandboxBuyer = (Deno.env.get("MP_TEST_BUYER_EMAIL") ?? "").trim();
  const payerEmail = sandboxBuyer || (userRow.user?.email ?? "").trim();
  if (!payerEmail) {
    return json(422, {
      error: "payer_email_missing",
      message: "Falta el mail de la cuenta de prueba de Mercado Pago.",
    });
  }

  const start = subscriptionChargeStartsAt(row.trial_ends_at);
  const mpBody = {
    reason: `YaChanga suscripción categoría ${row.category}`,
    external_reference: `store_id:${row.id}`,
    payer_email: payerEmail,
    back_url: backUrl(),
    status: "pending",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: fee,
      currency_id: "ARS",
      start_date: formatArgentinaIso(start),
    },
  };

  const res = await fetch("https://api.mercadopago.com/preapproval", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mpBody),
  });
  const txt = await res.text();
  if (!res.ok) {
    console.error("[mp_crear_suscripcion] mp_failed", res.status);
    return json(502, {
      error: "mp_preapproval_failed",
      message: "No se pudo abrir el débito de prueba.",
    });
  }

  let created: PreapprovalResponse;
  try {
    created = JSON.parse(txt) as PreapprovalResponse;
  } catch {
    return json(502, { error: "mp_invalid_response", message: "Mercado Pago respondió mal." });
  }

  const checkoutUrl = (created.sandbox_init_point ?? "").trim();
  if (!checkoutUrl) {
    return json(502, {
      error: "mp_sandbox_checkout_missing",
      message: "Mercado Pago no devolvió el checkout de prueba.",
    });
  }

  return json(200, {
    checkout_url: checkoutUrl,
    sandbox: true,
  });
});
