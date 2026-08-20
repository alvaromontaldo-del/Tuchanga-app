/// <reference lib="deno.ns" />

import {
  fetchMpPayment,
  findApprovedMpPayment,
  getMpAccessToken,
  processApprovedMpPayment,
  resolvePaymentContext,
  searchMpApprovedPaymentsForContratacion,
  searchMpPaymentsByPreferenceId,
  type PaymentConfirmContext,
  type TipoPagoMp,
} from "../_shared/mercadopago.ts";
import { createAdminClient, createUserClient, json } from "../_shared/supabaseAdmin.ts";

type Body = {
  contratacion_id?: string;
  order_id?: string;
  mp_payment_id?: string;
};

type TxRow = {
  external_reference: string;
  mp_preference_id: string | null;
  tipo_pago: TipoPagoMp;
  estado_mp: string;
  mp_payment_id: string | null;
};

async function resolveApprovedPayment(
  txs: TxRow[],
  ctxBase: PaymentConfirmContext,
): Promise<{ payment: Awaited<ReturnType<typeof fetchMpPayment>>; ctx: PaymentConfirmContext } | null> {
  for (const tx of txs) {
    const ctx: PaymentConfirmContext = {
      ...ctxBase,
      tipoPago: tx.tipo_pago,
      externalReference: tx.external_reference,
    };

    if (tx.mp_payment_id) {
      try {
        const payment = await fetchMpPayment(tx.mp_payment_id);
        if (String(payment.status ?? "").toLowerCase() === "approved") {
          return { payment, ctx };
        }
      } catch {
        /* seguir */
      }
    }

    if (tx.mp_preference_id) {
      try {
        const byPref = await searchMpPaymentsByPreferenceId(tx.mp_preference_id);
        const approved = byPref.find((p) => String(p.status ?? "").toLowerCase() === "approved");
        if (approved) return { payment: approved, ctx };
      } catch {
        /* seguir */
      }
    }

    try {
      const approved = await findApprovedMpPayment(ctx);
      if (approved) return { payment: approved, ctx };
    } catch {
      /* seguir */
    }
  }

  return null;
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

  if (!getMpAccessToken()) {
    return json(503, { error: "mp_not_configured" });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const contratacionId = (body.contratacion_id ?? "").trim();
  const orderId = (body.order_id ?? "").trim();
  if (!contratacionId && !orderId) {
    return json(400, { error: "contratacion_or_order_required" });
  }

  const mpPaymentIdHint = (body.mp_payment_id ?? "").trim();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "unauthorized" });

  let userId: string;
  try {
    const userClient = createUserClient(authHeader);
    const { data, error } = await userClient.auth.getUser();
    if (error || !data.user?.id) return json(401, { error: "unauthorized" });
    userId = data.user.id;
  } catch {
    return json(500, { error: "auth_setup_failed" });
  }

  const sb = createAdminClient();

  // --- Materiales ---
  if (orderId) {
    const { data: row, error: oe } = await sb
      .from("orders")
      .select("id, client_id, deposit_status, status")
      .eq("id", orderId)
      .maybeSingle();

    if (oe || !row) return json(404, { error: "order_not_found" });
    if (row.client_id !== userId) return json(403, { error: "forbidden_not_client" });

    if (row.deposit_status === "paid" || row.status === "deposit_paid" || row.status === "completed") {
      return json(200, {
        ok: true,
        estado_pago: "deposit_paid",
        already_paid: true,
      });
    }

    const { data: txs, error: txErr } = await sb
      .from("transacciones_pago")
      .select("external_reference, mp_preference_id, tipo_pago, estado_mp, mp_payment_id")
      .eq("material_order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (txErr || !txs?.length) {
      return json(409, { error: "no_pending_transaction" });
    }

    const baseCtx: PaymentConfirmContext = {
      orderId,
      tipoPago: "seña_materiales",
      externalReference: (txs[0] as TxRow).external_reference,
    };

    let resolved: Awaited<ReturnType<typeof resolveApprovedPayment>> = null;

    if (mpPaymentIdHint) {
      try {
        const payment = await fetchMpPayment(mpPaymentIdHint);
        if (String(payment.status ?? "").toLowerCase() === "approved") {
          const ctx = (await resolvePaymentContext(payment)) ?? baseCtx;
          resolved = { payment, ctx: { ...ctx, orderId } };
        }
      } catch {
        /* seguir */
      }
    }

    if (!resolved) {
      try {
        resolved = await resolveApprovedPayment(txs as TxRow[], baseCtx);
      } catch (e) {
        return json(502, {
          error: "mp_payment_search_failed",
          detail: String(e instanceof Error ? e.message : e),
        });
      }
    }

    if (!resolved) {
      const latest = txs[0] as TxRow;
      return json(200, {
        ok: false,
        estado_pago: row.deposit_status,
        mp_status: latest.estado_mp ?? "pending",
        message: "Pago aún no acreditado en Mercado Pago",
      });
    }

    try {
      await processApprovedMpPayment(resolved.payment, resolved.ctx);
    } catch (e) {
      return json(500, {
        error: "registrar_sena_material_failed",
        detail: String(e instanceof Error ? e.message : e),
      });
    }

    await sb
      .from("transacciones_pago")
      .update({
        estado_mp: "approved",
        mp_payment_id: String(resolved.payment.id),
        updated_at: new Date().toISOString(),
      })
      .eq("material_order_id", orderId)
      .neq("estado_mp", "approved");

    const { data: updated } = await sb
      .from("orders")
      .select("deposit_status, status")
      .eq("id", orderId)
      .maybeSingle();

    return json(200, {
      ok: true,
      estado_pago: updated?.status ?? "deposit_paid",
      deposit_status: updated?.deposit_status ?? "paid",
      mp_payment_id: String(resolved.payment.id),
    });
  }

  // --- Contratación / servicio ---
  const { data: row, error: ce } = await sb
    .from("contrataciones")
    .select("id,client_id,estado_pago")
    .eq("id", contratacionId)
    .maybeSingle();

  if (ce || !row) return json(404, { error: "contratacion_not_found" });
  if (row.client_id !== userId) return json(403, { error: "forbidden_not_client" });

  if (row.estado_pago === "seña_pagada" || row.estado_pago === "totalmente_pagado") {
    return json(200, { ok: true, estado_pago: row.estado_pago, already_paid: true });
  }

  const { data: txs, error: txErr } = await sb
    .from("transacciones_pago")
    .select("external_reference, mp_preference_id, tipo_pago, estado_mp, mp_payment_id")
    .eq("contratacion_id", contratacionId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (txErr || !txs?.length) {
    return json(409, { error: "no_pending_transaction" });
  }

  let resolved: Awaited<ReturnType<typeof resolveApprovedPayment>> = null;

  if (mpPaymentIdHint) {
    try {
      const payment = await fetchMpPayment(mpPaymentIdHint);
      if (String(payment.status ?? "").toLowerCase() === "approved") {
        const ctx = await resolvePaymentContext(payment);
        if (ctx?.contratacionId === contratacionId) {
          resolved = { payment, ctx };
        } else {
          const fallbackCtx: PaymentConfirmContext = {
            contratacionId,
            tipoPago: (txs[0] as TxRow).tipo_pago,
            externalReference: (txs[0] as TxRow).external_reference,
          };
          resolved = { payment, ctx: fallbackCtx };
        }
      }
    } catch {
      /* seguir con búsqueda */
    }
  }

  if (!resolved) {
    try {
      const approvedList = await searchMpApprovedPaymentsForContratacion(contratacionId);
      const payment = approvedList[0] ?? null;
      if (payment) {
        const ctx =
          (await resolvePaymentContext(payment)) ??
          ({
            contratacionId,
            tipoPago: (txs[0] as TxRow).tipo_pago,
            externalReference: (txs[0] as TxRow).external_reference,
          } as PaymentConfirmContext);
        if (ctx.contratacionId === contratacionId) {
          resolved = { payment, ctx };
        }
      }
    } catch {
      /* seguir */
    }
  }

  if (!resolved) {
    try {
      resolved = await resolveApprovedPayment(txs as TxRow[], {
        contratacionId,
        tipoPago: (txs[0] as TxRow).tipo_pago,
        externalReference: (txs[0] as TxRow).external_reference,
      });
    } catch (e) {
      return json(502, {
        error: "mp_payment_search_failed",
        detail: String(e instanceof Error ? e.message : e),
      });
    }
  }

  if (!resolved) {
    const latest = txs[0] as TxRow;
    return json(200, {
      ok: false,
      estado_pago: row.estado_pago,
      mp_status: latest.estado_mp ?? "pending",
      message: "Pago aún no acreditado en Mercado Pago",
    });
  }

  try {
    await processApprovedMpPayment(resolved.payment, resolved.ctx);
  } catch (e) {
    return json(500, {
      error: "registrar_seña_failed",
      detail: String(e instanceof Error ? e.message : e),
    });
  }

  await sb
    .from("transacciones_pago")
    .update({
      estado_mp: "approved",
      mp_payment_id: String(resolved.payment.id),
      updated_at: new Date().toISOString(),
    })
    .eq("contratacion_id", contratacionId)
    .eq("tipo_pago", resolved.ctx.tipoPago)
    .neq("estado_mp", "approved");

  const { data: updated } = await sb
    .from("contrataciones")
    .select("estado_pago")
    .eq("id", contratacionId)
    .maybeSingle();

  return json(200, {
    ok: true,
    estado_pago: updated?.estado_pago ?? "seña_pagada",
    mp_payment_id: String(resolved.payment.id),
  });
});
