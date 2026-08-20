/// <reference lib="deno.ns" />

import { MercadoPagoConfig, Payment } from "npm:mercadopago@2";
import {
  fetchMpPayment,
  getMpAccessToken,
  processApprovedMpPayment,
  resolvePaymentContext,
  type MpPayment,
} from "../_shared/mercadopago.ts";
import { createAdminClient, json } from "../_shared/supabaseAdmin.ts";

type WebhookBody = {
  action?: string;
  type?: string;
  topic?: string;
  data?: { id?: string | number };
  id?: string | number;
};

type WebhookTopic = "payment" | "merchant_order" | "unknown";

type ProcessResult = {
  processed?: string;
  skipped?: string;
  payment_id?: string;
  error?: string;
};

function ok(body: Record<string, unknown> = { ok: true }): Response {
  return json(200, body);
}

function logInfo(message: string, extra?: Record<string, unknown>): void {
  console.log(`[mp_webhook] ${message}`, extra ?? "");
}

function logError(message: string, extra?: unknown): void {
  console.error(`[mp_webhook] ${message}`, extra ?? "");
}

function extractResourceId(req: Request, body: WebhookBody): string | null {
  const url = new URL(req.url);
  const queryId =
    url.searchParams.get("id") ??
    url.searchParams.get("data.id") ??
    url.searchParams.get("data_id");
  if (queryId) return String(queryId);

  const fromData = body?.data?.id ?? body?.id;
  if (fromData != null) return String(fromData);
  return null;
}

function resolveTopic(req: Request, body: WebhookBody): WebhookTopic {
  const url = new URL(req.url);
  const raw = (
    body.topic ??
    body.type ??
    url.searchParams.get("topic") ??
    url.searchParams.get("type") ??
    ""
  )
    .toString()
    .toLowerCase();

  if (raw.includes("payment")) return "payment";
  if (raw.includes("merchant_order")) return "merchant_order";
  return "unknown";
}

async function validateMpSignature(req: Request, dataId: string): Promise<boolean> {
  const secret = (Deno.env.get("MP_WEBHOOK_SECRET") ?? "").trim();
  if (!secret) return true;

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature || !xRequestId) {
    logError("signature_headers_missing", { dataId });
    return false;
  }

  let ts = "";
  let hash = "";
  for (const part of xSignature.split(",")) {
    const [key, value] = part.split("=").map((s) => s.trim());
    if (key === "ts") ts = value ?? "";
    if (key === "v1") hash = value ?? "";
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computed !== hash) {
    logError("signature_mismatch", { dataId, xRequestId });
    return false;
  }
  return true;
}

function getPaymentSdk(): Payment {
  return new Payment(new MercadoPagoConfig({ accessToken: getMpAccessToken() }));
}

async function fetchPaymentById(paymentId: string): Promise<MpPayment> {
  try {
    const sdk = getPaymentSdk();
    const result = await sdk.get({ id: paymentId });
    return result as MpPayment;
  } catch (e) {
    logError("sdk_payment_get_failed", { paymentId, detail: String(e) });
    return await fetchMpPayment(paymentId);
  }
}

async function updateTransaccionEstado(
  ctx: { contratacionId?: string; orderId?: string; tipoPago: string },
  estadoMp: string,
  mpPaymentId: string,
): Promise<void> {
  const sb = createAdminClient();
  let q = sb
    .from("transacciones_pago")
    .update({
      estado_mp: estadoMp,
      mp_payment_id: mpPaymentId,
      updated_at: new Date().toISOString(),
    })
    .eq("tipo_pago", ctx.tipoPago)
    .neq("estado_mp", "approved");

  if (ctx.orderId) {
    q = q.eq("material_order_id", ctx.orderId);
  } else if (ctx.contratacionId) {
    q = q.eq("contratacion_id", ctx.contratacionId);
  } else {
    logError("update_tx_missing_ids", { tipoPago: ctx.tipoPago, mpPaymentId });
    return;
  }

  const { error } = await q;
  if (error) {
    logError("update_tx_failed", { detail: error.message, mpPaymentId, orderId: ctx.orderId });
  }
}

async function processPaymentRecord(payment: MpPayment): Promise<ProcessResult> {
  const paymentId = String(payment.id ?? "");
  const ctx = await resolvePaymentContext(payment);
  if (!ctx) {
    return { skipped: "payment_context_unresolved", payment_id: paymentId };
  }

  const status = String(payment.status ?? "").toLowerCase();

  if (status === "approved") {
    try {
      await processApprovedMpPayment(payment, ctx);
      await updateTransaccionEstado(
        {
          contratacionId: ctx.contratacionId,
          orderId: ctx.orderId,
          tipoPago: ctx.tipoPago,
        },
        "approved",
        paymentId,
      );
      return { processed: "approved", payment_id: paymentId };
    } catch (e) {
      logError("registrar_seña_failed", {
        paymentId,
        contratacionId: ctx.contratacionId,
        orderId: ctx.orderId,
        detail: String(e instanceof Error ? e.message : e),
      });
      return { error: "registrar_seña_failed", payment_id: paymentId };
    }
  }

  const estadoMp =
    status === "rejected" || status === "cancelled"
      ? status
      : status === "refunded"
        ? "refunded"
        : "pending";

  await updateTransaccionEstado(
    {
      contratacionId: ctx.contratacionId,
      orderId: ctx.orderId,
      tipoPago: ctx.tipoPago,
    },
    estadoMp,
    paymentId,
  );
  return { processed: estadoMp, payment_id: paymentId };
}

async function processPaymentNotification(paymentId: string): Promise<ProcessResult> {
  let payment: MpPayment;
  try {
    payment = await fetchPaymentById(paymentId);
  } catch (e) {
    logError("payment_fetch_failed", { paymentId, detail: String(e) });
    return { error: "mp_payment_fetch_failed", payment_id: paymentId };
  }
  return await processPaymentRecord(payment);
}

async function fetchMerchantOrder(orderId: string): Promise<{
  payments?: Array<{ id?: number | string; status?: string }>;
  preference_id?: string;
  external_reference?: string;
} | null> {
  const token = getMpAccessToken();
  const res = await fetch(`https://api.mercadopago.com/merchant_orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const txt = await res.text();
  if (!res.ok) {
    logError("merchant_order_fetch_failed", { orderId, status: res.status, txt });
    return null;
  }
  return JSON.parse(txt) as {
    payments?: Array<{ id?: number | string; status?: string }>;
    preference_id?: string;
    external_reference?: string;
  };
}

async function processMerchantOrderNotification(orderId: string): Promise<ProcessResult> {
  const order = await fetchMerchantOrder(orderId);
  if (!order) {
    return { error: "merchant_order_fetch_failed", payment_id: orderId };
  }

  const payments = order.payments ?? [];
  if (!payments.length) {
    logInfo("merchant_order_without_payments", { orderId, preference_id: order.preference_id });
    return { skipped: "merchant_order_without_payments", payment_id: orderId };
  }

  logInfo("merchant_order_payments", {
    orderId,
    payments: payments.map((p) => ({ id: p.id, status: p.status })),
  });

  let last: ProcessResult = { skipped: "no_payment_processed", payment_id: orderId };
  for (const p of payments) {
    if (p.id == null) continue;
    const result = await processPaymentNotification(String(p.id));
    last = result;
    logInfo("merchant_order_payment_result", { orderId, paymentId: p.id, result });
    if (result.processed === "approved") return result;
  }
  return last;
}

function scheduleMerchantOrderRetry(orderId: string): void {
  const task = (async () => {
    for (const delayMs of [3000, 8000, 15000]) {
      await new Promise((r) => setTimeout(r, delayMs));
      const order = await fetchMerchantOrder(orderId);
      const payments = order?.payments ?? [];
      if (!payments.length) continue;
      logInfo("merchant_order_retry_hit", { orderId, delayMs, count: payments.length });
      const result = await processMerchantOrderNotification(orderId);
      logInfo("merchant_order_retry_result", { orderId, result });
      if (result.processed === "approved") return;
    }
  })();

  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(task);
  } else {
    void task;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json(405, { error: "method_not_allowed" });
  }

  if (!getMpAccessToken()) {
    logError("mp_not_configured");
    return ok({ ok: false, error: "mp_not_configured" });
  }

  let body: WebhookBody = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as WebhookBody;
    } catch {
      body = {};
    }
  }

  const resourceId = extractResourceId(req, body);
  if (!resourceId) {
    logInfo("skipped_no_resource_id", { method: req.method });
    return ok({ ok: true, skipped: "no_resource_id" });
  }

  const signatureOk = await validateMpSignature(req, resourceId);
  if (!signatureOk) {
    return ok({ ok: false, error: "invalid_signature" });
  }

  const topic = resolveTopic(req, body);
  logInfo("notification_received", { topic, resourceId, action: body.action });

  try {
    if (topic === "merchant_order") {
      const result = await processMerchantOrderNotification(resourceId);
      if (result.skipped === "merchant_order_without_payments") {
        scheduleMerchantOrderRetry(resourceId);
      }
      logInfo("notification_processed", { topic, resourceId, result });
      return ok({ ok: true, topic, ...result });
    }

    if (topic === "payment" || topic === "unknown") {
      const result = await processPaymentNotification(resourceId);
      logInfo("notification_processed", { topic, resourceId, result });
      return ok({ ok: true, topic: topic === "unknown" ? "payment_assumed" : topic, ...result });
    }

    return ok({ ok: true, skipped: "unsupported_topic", topic });
  } catch (e) {
    logError("unhandled", { resourceId, topic, detail: String(e) });
    return ok({ ok: false, error: "unhandled", detail: String(e instanceof Error ? e.message : e) });
  }
});
