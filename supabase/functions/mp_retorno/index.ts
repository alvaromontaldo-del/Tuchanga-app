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
  const { data: order, error: oe } = await sb
    .from("orders")
    .select("id, quote_id, payment_group_id, verification_pin")
    .eq("id", orderId)
    .maybeSingle();
  if (oe || !order) throw new Error(oe?.message ?? "order_not_found");

  const groupId = (order as { payment_group_id?: string | null }).payment_group_id ?? null;
  const ids: string[] = [orderId];
  if (groupId) {
    const { data: siblings } = await sb.from("orders").select("id, quote_id").eq("payment_group_id", groupId);
    for (const s of siblings ?? []) ids.push(String((s as { id: string }).id));
  }

  const now = new Date().toISOString();
  for (const id of [...new Set(ids)]) {
    const pin =
      id === orderId && (order as { verification_pin?: string | null }).verification_pin
        ? String((order as { verification_pin: string }).verification_pin).padStart(4, "0")
        : String(Math.floor(1000 + Math.random() * 9000));
    const { error: uo } = await sb
      .from("orders")
      .update({
        deposit_status: "paid",
        status: "deposit_paid",
        contact_revealed_at: now,
        verification_pin: pin,
        updated_at: now,
      })
      .eq("id", id)
      .neq("status", "completed");
    if (uo) throw new Error(uo.message);

    const { data: row } = await sb.from("orders").select("quote_id").eq("id", id).maybeSingle();
    const quoteId = (row as { quote_id?: string } | null)?.quote_id;
    if (quoteId) {
      await sb.from("quotes").update({ status: "accepted", updated_at: now }).eq("id", quoteId);
    }
  }

  if (groupId) {
    await sb.from("material_checkouts").update({ status: "paid", updated_at: now }).eq("id", groupId);
  }

  await sb
    .from("transacciones_pago")
    .update({
      estado_mp: "approved",
      mp_payment_id: String(payment.id),
      updated_at: now,
    })
    .eq("material_order_id", orderId);
}

/**
 * back_url HTTPS de Checkout Pro.
 * Acredita el pago EN EL SERVIDOR (no depende del deep link de la app).
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

  if (status === "approved" && (paymentId || materialOrderId)) {
    try {
      const payment = await resolveApprovedPayment(paymentId, materialOrderId);
      if (!payment) {
        throw new Error("mp_approved_payment_not_found");
      }
      const ctx = (await resolvePaymentContext(payment)) ?? {
        orderId: materialOrderId || undefined,
        contratacionId: contratacionId || undefined,
        tipoPago: materialOrderId ? "seña_materiales" as const : "seña_inicial" as const,
        externalReference: materialOrderId
          ? buildMaterialOrderExternalReference(materialOrderId)
          : "",
      };
      if (materialOrderId && !ctx.orderId) ctx.orderId = materialOrderId;
      if (contratacionId && !ctx.contratacionId) ctx.contratacionId = contratacionId;

      try {
        const result = await processApprovedMpPayment(payment, ctx);
        credited = result === "processed";
      } catch (e) {
        creditError = String(e instanceof Error ? e.message : e);
        console.error("[mp_retorno] registrar_failed", creditError);
        if (materialOrderId) {
          await fallbackMarkPaid(materialOrderId, payment);
          credited = true;
          creditError = "";
        } else {
          throw e;
        }
      }

      if (!credited && materialOrderId) {
        await fallbackMarkPaid(materialOrderId, payment);
        credited = true;
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
  const deepLink = `tuchanga-app://pagos/retorno?${qs.toString()}`;
  const intentLink =
    `intent://pagos/retorno?${qs.toString()}` +
    `#Intent;scheme=tuchanga-app;package=com.cuervolinkedout.tuchanga;end`;

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
        : "Estamos acreditando el pago. Cerra esta pantalla y volve a YaChanga."
      : "Volve a YaChanga para continuar.";

  const payload = JSON.stringify({
    type: "mp_retorno",
    status,
    paymentId,
    materialOrderId,
    contratacionId,
    credited,
  });

  // ASCII-safe HTML + bytes UTF-8: evita text/plain / mojibake en Chrome al volver de MP.
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>YaChanga - Pago</title>
  <style>
    body { font-family: system-ui, sans-serif; text-align: center; padding: 48px 20px; color: #111; background: #fff; }
    p { color: #555; line-height: 1.4; }
    a.btn { display: inline-block; margin-top: 16px; padding: 14px 22px; background: #9A0F12; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 700; }
    a.secondary { display: block; margin-top: 18px; color: #9A0F12; font-weight: 700; }
  </style>
</head>
<body data-yc-mp-retorno="1" data-yc-status="${status}" data-yc-credited="${credited ? "1" : "0"}">
  <h1>${title}</h1>
  <p>${subtitle}</p>
  <p><a class="btn" href="${deepLink}">Abrir YaChanga</a></p>
  <p><a class="secondary" href="${intentLink}">Abrir app (Android)</a></p>
  <!-- ${creditError.replace(/--/g, "")} -->
  <script>
    (function () {
      var payload = ${payload};
      var deep = ${JSON.stringify(deepLink)};
      var intent = ${JSON.stringify(intentLink)};
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      } catch (e) {}
      try { window.location.replace(deep); } catch (e) {}
      setTimeout(function () {
        try { window.location.href = intent; } catch (e2) {}
      }, 400);
    })();
  </script>
</body>
</html>`;

  const body = new TextEncoder().encode(html);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
