/// <reference lib="deno.ns" />

import {
  buildExternalReference,
  buildMaterialOrderExternalReference,
  createCheckoutPreference,
  getMpAccessToken,
  isMpSandboxToken,
  resolveCheckoutUrl,
  type TipoPagoMp,
} from "../_shared/mercadopago.ts";
import { createAdminClient, createUserClient, json } from "../_shared/supabaseAdmin.ts";

type ContratacionRow = {
  id: string;
  client_id: string;
  worker_id: string;
  service_detail: string;
  comision_app: number;
  estado_trabajo: string;
  estado_pago: string;
};

type OrderRow = {
  id: string;
  client_id: string;
  deposit_amount: number;
  deposit_status: string;
  status: string;
  accepted_total: number;
};

type CreateBody = {
  contratacion_id?: string;
  order_id?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Costo de servicio / MP: enteros hacia arriba (100.01 → 101). */
function ceilMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

async function computeMontoSeña(
  sb: ReturnType<typeof createAdminClient>,
  row: ContratacionRow,
): Promise<{ monto: number; tipoPago: TipoPagoMp }> {
  if (row.estado_pago !== "pendiente_seña") {
    throw new Error("estado_pago_invalido");
  }

  if (row.estado_trabajo === "pendiente_pago_diferencia") {
    return { monto: round2(Number(row.comision_app) || 0), tipoPago: "diferencia_seña" };
  }

  if (row.estado_trabajo === "aceptado") {
    return { monto: round2(Number(row.comision_app) || 0), tipoPago: "seña_inicial" };
  }

  if (row.estado_trabajo === "en_curso") {
    const { data: txs } = await sb
      .from("transacciones_pago")
      .select("monto")
      .eq("contratacion_id", row.id)
      .eq("estado_mp", "approved")
      .in("tipo_pago", ["seña_inicial", "diferencia_seña"]);

    const pagado = (txs ?? []).reduce((acc, t) => acc + Number(t.monto ?? 0), 0);
    const diff = round2(Math.max(Number(row.comision_app) - pagado, 0));
    return { monto: diff, tipoPago: "diferencia_seña" };
  }

  throw new Error("estado_trabajo_invalido");
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

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const contratacionId = (body.contratacion_id ?? "").trim();
  const orderId = (body.order_id ?? "").trim();
  if (!contratacionId && !orderId) {
    return json(400, { error: "contratacion_or_order_required" });
  }

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
  const { data: userRow } = await sb.auth.admin.getUserById(userId);
  const payerEmail = userRow.user?.email ?? undefined;

  // --- Seña materiales ---
  if (orderId) {
    const { data: row, error: oe } = await sb
      .from("orders")
      .select("id, client_id, deposit_amount, deposit_status, status, accepted_total, payment_group_id")
      .eq("id", orderId)
      .maybeSingle();

    if (oe || !row) return json(404, { error: "order_not_found" });
    const order = row as OrderRow & { payment_group_id?: string | null };

    if (order.client_id !== userId) {
      return json(403, { error: "forbidden_not_client" });
    }

    if (order.deposit_status === "paid" || order.status === "deposit_paid" || order.status === "completed") {
      return json(409, { error: "already_paid" });
    }

    if (order.deposit_status !== "pending" || !["pending_deposit", "pending"].includes(order.status)) {
      return json(409, { error: "order_not_awaiting_deposit" });
    }

    const monto = ceilMoney(Number(order.deposit_amount) || 0);
    if (monto <= 0) return json(409, { error: "monto_cero" });

    const tipoPago: TipoPagoMp = "seña_materiales";
    const externalReference = buildMaterialOrderExternalReference(orderId);
    const idempotencyKey = crypto.randomUUID();
    const paymentGroupId = order.payment_group_id ?? null;

    let preference;
    try {
      preference = await createCheckoutPreference({
        title: `Costo de servicio YaChanga · materiales`,
        amount: monto,
        payerEmail,
        externalReference,
        orderId,
        paymentGroupId,
        checkoutId: paymentGroupId,
        metadata: {
          material_order_id: orderId,
          payment_group_id: paymentGroupId,
          checkout_id: paymentGroupId,
        },
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg.includes("mp_not_configured")) {
        return json(503, { error: "mp_not_configured" });
      }
      return json(502, { error: "mp_preference_failed", detail: msg });
    }

    const checkoutUrl = resolveCheckoutUrl(preference);
    if (!checkoutUrl) {
      return json(502, { error: "mp_missing_checkout_url" });
    }

    const { error: te } = await sb.from("transacciones_pago").insert({
      contratacion_id: null,
      material_order_id: orderId,
      cliente_id: userId,
      tipo_pago: tipoPago,
      monto,
      estado_mp: "pending",
      mp_preference_id: preference.id,
      idempotency_key: idempotencyKey,
      external_reference: externalReference,
      metadata: {
        source: "mp_crear_preferencia_materiales",
        material_order_id: orderId,
        payment_group_id: paymentGroupId,
        checkout_id: paymentGroupId,
      },
    });

    if (te) {
      return json(500, { error: "transaccion_insert_failed", detail: te.message });
    }

    return json(200, {
      checkout_url: checkoutUrl,
      preference_id: preference.id,
      monto,
      tipo_pago: tipoPago,
      external_reference: externalReference,
      sandbox: isMpSandboxToken(),
      material_order_id: orderId,
      payment_group_id: paymentGroupId,
    });
  }

  // --- Seña servicio / contratación ---
  const { data: row, error: ce } = await sb
    .from("contrataciones")
    .select("id,client_id,worker_id,service_detail,comision_app,estado_trabajo,estado_pago")
    .eq("id", contratacionId)
    .maybeSingle();

  if (ce || !row) return json(404, { error: "contratacion_not_found" });
  const contratacion = row as ContratacionRow;

  if (contratacion.client_id !== userId) {
    return json(403, { error: "forbidden_not_client" });
  }

  let monto: number;
  let tipoPago: TipoPagoMp;
  try {
    ({ monto, tipoPago } = await computeMontoSeña(sb, contratacion));
  } catch (e) {
    return json(409, { error: String(e instanceof Error ? e.message : e) });
  }

  monto = ceilMoney(monto);

  if (monto <= 0) {
    return json(409, { error: "monto_cero_usar_credito" });
  }

  const externalReference = buildExternalReference(contratacionId, tipoPago);
  const idempotencyKey = crypto.randomUUID();

  let preference;
  try {
    preference = await createCheckoutPreference({
      title: `Costo de servicio YaChanga · ${(contratacion.service_detail || "Servicio").slice(0, 80)}`,
      amount: monto,
      payerEmail,
      externalReference,
      contratacionId,
    });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (msg.includes("mp_not_configured")) {
      return json(503, { error: "mp_not_configured" });
    }
    return json(502, { error: "mp_preference_failed", detail: msg });
  }

  const checkoutUrl = resolveCheckoutUrl(preference);
  if (!checkoutUrl) {
    return json(502, { error: "mp_missing_checkout_url" });
  }

  const { error: te } = await sb.from("transacciones_pago").insert({
    contratacion_id: contratacionId,
    cliente_id: userId,
    tipo_pago: tipoPago,
    monto,
    estado_mp: "pending",
    mp_preference_id: preference.id,
    idempotency_key: idempotencyKey,
    external_reference: externalReference,
    metadata: { source: "mp_crear_preferencia" },
  });

  if (te) {
    return json(500, { error: "transaccion_insert_failed", detail: te.message });
  }

  return json(200, {
    checkout_url: checkoutUrl,
    preference_id: preference.id,
    monto,
    tipo_pago: tipoPago,
    external_reference: externalReference,
    sandbox: isMpSandboxToken(),
  });
});
