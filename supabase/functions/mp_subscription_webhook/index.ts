/// <reference lib="deno.ns" />

import { getMpAccessToken, isMpSandboxMode } from "../_shared/mercadopago.ts";
import {
  mpWebhookSecretStatus,
  normalizeMpDataId,
  verifyMpWebhookSignature,
} from "../_shared/mpWebhookValidation.ts";
import { resolveMpSubscriptionWebhookSecret } from "../_shared/secretResolver.ts";
import { createAdminClient, json } from "../_shared/supabaseAdmin.ts";

type WebhookBody = {
  action?: string;
  type?: string;
  topic?: string;
  data?: { id?: string | number };
  id?: string | number;
};

type Topic = "preapproval" | "authorized_payment" | "payment" | "unknown";

function ok(body: Record<string, unknown> = { ok: true }): Response {
  return json(200, body);
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

function signatureDataId(req: Request, fallbackId: string): string {
  const url = new URL(req.url);
  const fromQuery =
    url.searchParams.get("data.id") ??
    url.searchParams.get("data_id") ??
    url.searchParams.get("id");
  return normalizeMpDataId(fromQuery ?? fallbackId);
}

function resolveTopic(req: Request, body: WebhookBody): Topic {
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
  if (raw.includes("authorized_payment") || raw.includes("subscription_authorized")) {
    return "authorized_payment";
  }
  if (raw.includes("preapproval")) return "preapproval";
  if (raw.includes("payment")) return "payment";
  return "unknown";
}

function storeIdFromReference(ref: unknown): string | null {
  const match = String(ref ?? "").match(/store_id:([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function fetchMp(path: string): Promise<Record<string, unknown> | null> {
  const token = getMpAccessToken();
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error("[mp_subscription_webhook] mp_fetch_failed", path, res.status);
    return null;
  }
  return asRecord(await res.json());
}

function liveModeBlocked(row: Record<string, unknown>): boolean {
  return row.live_mode === true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json(405, { error: "method_not_allowed" });
  }

  if (!isMpSandboxMode()) {
    return json(403, { error: "mp_live_disabled" });
  }
  if (!getMpAccessToken()) return ok({ ok: false, error: "mp_not_configured" });

  const secret = await resolveMpSubscriptionWebhookSecret();
  if (mpWebhookSecretStatus(secret) === 503) {
    return json(503, { error: "webhook_secret_not_configured" });
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
  const signatureOk = await verifyMpWebhookSignature({
    secret,
    dataId: signatureDataId(req, resourceId ?? ""),
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
  });
  if (!signatureOk) return json(401, { error: "invalid_signature" });
  if (!resourceId) return ok({ ok: true, skipped: "no_resource_id" });

  const topic = resolveTopic(req, body);
  const encoded = encodeURIComponent(resourceId);
  let source: "payment" | "preapproval" = "preapproval";
  let mpId = resourceId;
  let status = "";
  let storeId: string | null = null;
  let preapprovalId: string | null = null;
  let payerId: string | null = null;

  if (topic === "payment" || topic === "unknown") {
    const payment = await fetchMp(`/v1/payments/${encoded}`);
    if (!payment) return ok({ ok: false, error: "mp_payment_fetch_failed" });
    if (liveModeBlocked(payment)) return ok({ ok: true, skipped: "live_mode" });
    storeId = storeIdFromReference(payment.external_reference);
    const metadata = asRecord(payment.metadata);
    preapprovalId =
      (typeof payment.preapproval_id === "string" && payment.preapproval_id) ||
      (typeof metadata.preapproval_id === "string" && metadata.preapproval_id) ||
      null;
    if (!storeId && !preapprovalId) return ok({ ok: true, skipped: "not_a_subscription" });
    source = "payment";
    mpId = String(payment.id ?? resourceId);
    status = String(payment.status ?? "").toLowerCase();
    payerId = payment.payer_id != null ? String(payment.payer_id) : null;
  } else if (topic === "authorized_payment") {
    const authorized = await fetchMp(`/authorized_payments/${encoded}`);
    if (!authorized) return ok({ ok: false, error: "mp_authorized_fetch_failed" });
    if (liveModeBlocked(authorized)) return ok({ ok: true, skipped: "live_mode" });
    const payment = asRecord(authorized.payment);
    storeId = storeIdFromReference(authorized.external_reference);
    preapprovalId = typeof authorized.preapproval_id === "string" ? authorized.preapproval_id : null;
    const paymentStatus = String(payment.status ?? "").toLowerCase();
    if (payment.id != null && paymentStatus) {
      source = "payment";
      mpId = String(payment.id);
      status = paymentStatus;
    } else {
      source = "preapproval";
      mpId = preapprovalId ?? resourceId;
      status = String(authorized.status ?? "authorized").toLowerCase();
    }
    payerId = authorized.payer_id != null ? String(authorized.payer_id) : null;
  } else {
    const preapproval = await fetchMp(`/preapproval/${encoded}`);
    if (!preapproval) return ok({ ok: false, error: "mp_preapproval_fetch_failed" });
    if (liveModeBlocked(preapproval)) return ok({ ok: true, skipped: "live_mode" });
    storeId = storeIdFromReference(preapproval.external_reference);
    preapprovalId = typeof preapproval.id === "string" ? preapproval.id : resourceId;
    source = "preapproval";
    mpId = preapprovalId;
    status = String(preapproval.status ?? "").toLowerCase();
    payerId = preapproval.payer_id != null ? String(preapproval.payer_id) : null;
  }

  if (!status) return ok({ ok: true, skipped: "status_missing" });

  const sb = createAdminClient();
  const { data, error } = await sb.rpc("apply_store_subscription_mp_event", {
    p_source: source,
    p_mp_id: mpId,
    p_status: status,
    p_store_id: storeId,
    p_preapproval_id: preapprovalId,
    p_payer_id: payerId,
  });
  if (error) {
    console.error("[mp_subscription_webhook] apply_failed", error.message);
    return ok({ ok: false, error: "apply_failed" });
  }
  return ok({ ok: true, topic, result: data });
});
