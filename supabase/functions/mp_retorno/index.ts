/// <reference lib="deno.ns" />

import {
  buildMaterialOrderExternalReference,
  fetchMpPayment,
  getMpAccessToken,
  processApprovedMpPayment,
  resolvePaymentContext,
  searchMpPaymentsByPreferenceId,
  type MpPayment,
} from "../_shared/mercadopago.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

async function fetchMerchantOrderPayments(resourceId: string): Promise<MpPayment[]> {
  const token = getMpAccessToken();
  if (!token) return [];
  const res = await fetch(`https://api.mercadopago.com/merchant_orders/${resourceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = JSON.parse(await res.text()) as {
    payments?: Array<{ id?: number | string; status?: string }>;
  };
  const out: MpPayment[] = [];
  for (const p of data.payments ?? []) {
    if (p.id == null) continue;
    try {
      out.push(await fetchMpPayment(String(p.id)));
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function resolveApprovedPayment(
  paymentId: string,
  orderId: string,
): Promise<MpPayment | null> {
  if (paymentId) {
    try {
      const payment = await fetchMpPayment(paymentId);
      if (String(payment.status ?? "").toLowerCase() === "approved") return payment;
    } catch (e) {
      console.error("[mp_retorno] fetch_payment_failed", String(e));
    }
    try {
      const fromOrder = await fetchMerchantOrderPayments(paymentId);
      const approved = fromOrder.find((p) => String(p.status ?? "").toLowerCase() === "approved");
      if (approved) return approved;
    } catch (e) {
      console.error("[mp_retorno] merchant_order_failed", String(e));
    }
  }

  if (!orderId) return null;
  const sb = createAdminClient();
  const { data: txs } = await sb
    .from("transacciones_pago")
    .select("mp_preference_id, mp_payment_id")
    .eq("material_order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(10);

  for (const tx of txs ?? []) {
    const pid = String((tx as { mp_payment_id?: string }).mp_payment_id ?? "");
    if (pid) {
      try {
        const payment = await fetchMpPayment(pid);
        if (String(payment.status ?? "").toLowerCase() === "approved") return payment;
      } catch {
        /* ignore */
      }
    }
    const pref = String((tx as { mp_preference_id?: string }).mp_preference_id ?? "");
    if (!pref) continue;
    try {
      const rows = await searchMpPaymentsByPreferenceId(pref);
      const approved = rows.find((p) => String(p.status ?? "").toLowerCase() === "approved");
      if (approved) return approved;
    } catch (e) {
      console.error("[mp_retorno] pref_search_failed", String(e));
    }
  }
  return null;
}

async function fallbackMarkPaid(orderId: string, payment: MpPayment): Promise<void> {
  const sb = createAdminClient();
  const idempotencyKey = `mp_retorno_fallback:${payment.id}:${orderId}`;
  const { error } = await sb.rpc("registrar_sena_material_aprobada", {
    p_order_id: orderId,
    p_monto: Number(payment.transaction_amount ?? 0),
    p_mp_payment_id: String(payment.id),
    p_mp_preference_id: payment.preference_id ? String(payment.preference_id) : null,
    p_idempotency_key: idempotencyKey,
    p_external_reference: buildMaterialOrderExternalReference(orderId),
  });
  if (error) throw new Error(error.message);
}

/**
 * back_url HTTPS de Checkout Pro.
 * Acredita el pago EN EL SERVIDOR (no depende del deep link de la app).
 *
 * IMPORTANTE: Supabase Edge reescribe text/html → text/plain (no se puede servir HTML).
 * Por eso respondemos 302 al deep link + cuerpo texto plano legible.
 */
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

  const url = new URL(req.url);
  const statusRaw = (
    url.searchParams.get("collection_status") ??
    url.searchParams.get("status") ??
    url.searchParams.get("yc_status") ??
    ""
  ).toLowerCase();
  const status =
    statusRaw === "approved" || statusRaw === "success"
      ? "approved"
      : statusRaw === "pending" || statusRaw === "in_process"
        ? "pending"
        : statusRaw === ""
          ? "unknown"
          : "failure";
  const paymentId = (
    url.searchParams.get("payment_id") ??
    url.searchParams.get("collection_id") ??
    ""
  ).trim();
  const materialOrderId = (
    url.searchParams.get("material_order_id") ??
    url.searchParams.get("order_id") ??
    ""
  ).trim();
  const contratacionId = (url.searchParams.get("contratacion_id") ?? "").trim();

  let credited = false;
  let creditError = "";

  if (status === "approved" && (paymentId || materialOrderId || contratacionId)) {
    try {
      const payment = await resolveApprovedPayment(paymentId, materialOrderId);
      if (!payment) {
        throw new Error("mp_approved_payment_not_found");
      }
      const ctx = (await resolvePaymentContext(payment)) ?? {
        orderId: materialOrderId || undefined,
        contratacionId: contratacionId || undefined,
        tipoPago: materialOrderId ? ("seña_materiales" as const) : ("seña_inicial" as const),
        externalReference: materialOrderId
          ? buildMaterialOrderExternalReference(materialOrderId)
          : "",
      };
      if (materialOrderId && !ctx.orderId) ctx.orderId = materialOrderId;
      if (contratacionId && !ctx.contratacionId) ctx.contratacionId = contratacionId;

      try {
        const result = await processApprovedMpPayment(payment, ctx);
        credited = result.outcome === "processed" || result.reason === "already_credited";
        if (!credited) {
          creditError = result.reason ?? "not_credited";
          console.error("[mp_retorno] credit_rejected", creditError);
        }
      } catch (e) {
        creditError = String(e instanceof Error ? e.message : e);
        console.error("[mp_retorno] registrar_failed", creditError);
        const rpcFailed = /registrar_sena/.test(creditError);
        if (materialOrderId && rpcFailed) {
          await fallbackMarkPaid(materialOrderId, payment);
          credited = true;
          creditError = "";
        } else if (!materialOrderId) {
          throw e;
        }
      }
    } catch (e) {
      creditError = String(e instanceof Error ? e.message : e);
      console.error("[mp_retorno] credit_failed", creditError);
    }
  }

  const qs = new URLSearchParams({ status: status === "unknown" ? "pending" : status });
  if (paymentId) qs.set("payment_id", paymentId);
  if (materialOrderId) qs.set("material_order_id", materialOrderId);
  if (contratacionId) qs.set("contratacion_id", contratacionId);
  if (credited) qs.set("credited", "1");
  const deepLink = `tuchanga-app://pagos/retorno?${qs.toString()}`;

  const title =
    status === "approved"
      ? credited
        ? "Pago acreditado"
        : "Pago recibido"
      : status === "pending"
        ? "Pago en proceso"
        : "Pago no completado";
  const subtitle =
    status === "approved"
      ? credited
        ? "Ya podes volver a YaChanga. El pedido quedo confirmado."
        : "Estamos acreditando el pago. Volve a YaChanga."
      : "Volve a YaChanga para continuar.";

  // Texto plano a proposito: Supabase no permite servir HTML desde Edge Functions
  // (Content-Type text/html se reescribe a text/plain y el navegador muestra el codigo fuente).
  const plain = [
    "YaChanga",
    "",
    title,
    subtitle,
    "",
    "Para volver a la app, abri este enlace:",
    deepLink,
    "",
    "Si no abre sola, volve a YaChanga manualmente: el pago ya quedo registrado en el servidor.",
    creditError ? `(ref: ${creditError.slice(0, 120)})` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return new Response(plain, {
    status: 302,
    headers: {
      Location: deepLink,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      // Fallback en navegadores que respetan Refresh con custom schemes
      Refresh: `0;url=${deepLink}`,
    },
  });
});
