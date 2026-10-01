import { createAdminClient } from "./supabaseAdmin.ts";
import {
  buildExternalReference,
  buildMaterialOrderExternalReference,
  parseExternalReference,
  type TipoPagoMp,
} from "./mpReference.ts";
import {
  paymentMatchesExpectedFee,
  type ExpectedFeeTarget,
} from "./mpWebhookValidation.ts";

export type {
  ParsedExternalReference,
  TipoPagoMp,
  TipoPagoMpRef,
} from "./mpReference.ts";
export {
  buildExternalReference,
  buildMaterialOrderExternalReference,
  parseExternalReference,
  tipoPagoFromRef,
  tipoPagoToRef,
} from "./mpReference.ts";

export function getMpAccessToken(): string {
  return (Deno.env.get("MP_ACCESS_TOKEN") ?? "").trim();
}

export function isMpSandboxMode(token = getMpAccessToken()): boolean {
  const explicit = (Deno.env.get("MP_SANDBOX") ?? "").trim().toLowerCase();
  if (explicit === "1" || explicit === "true" || explicit === "yes") return true;
  if (explicit === "0" || explicit === "false" || explicit === "no") return false;
  // TEST- = credenciales de prueba clásicas. APP_USR- puede ser test o prod:
  // sin MP_SANDBOX explícito, solo tratar TEST- como sandbox.
  return token.startsWith("TEST-");
}

export function isMpSandboxToken(token = getMpAccessToken()): boolean {
  return isMpSandboxMode(token);
}

export function resolveCheckoutUrl(preference: MpPreferenceResponse): string | null {
  const token = getMpAccessToken();
  if (isMpSandboxMode(token)) {
    return preference.sandbox_init_point ?? preference.init_point ?? null;
  }
  return preference.init_point ?? preference.sandbox_init_point ?? null;
}

export function getMpWebhookUrl(): string {
  const explicit = (Deno.env.get("MP_NOTIFICATION_URL") ?? "").trim();
  if (explicit) return explicit;
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/mp_webhook`;
}

export function getAppReturnBase(): string {
  return (Deno.env.get("MP_APP_RETURN_SCHEME") ?? "tuchanga-app").replace(/\/$/, "");
}

export function getMpSandboxBuyerEmail(): string {
  return (Deno.env.get("MP_TEST_BUYER_EMAIL") ?? "").trim();
}

export type MpPreferenceResponse = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
};

export async function createCheckoutPreference(params: {
  title: string;
  amount: number;
  payerEmail?: string;
  externalReference: string;
  contratacionId?: string;
  orderId?: string;
  paymentGroupId?: string | null;
  checkoutId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<MpPreferenceResponse> {
  const token = getMpAccessToken();
  if (!token) throw new Error("mp_not_configured");

  const notificationUrl = getMpWebhookUrl();
  const sandbox = isMpSandboxMode(token);
  const sandboxBuyerEmail = getMpSandboxBuyerEmail();
  const forceSandboxPayer = (Deno.env.get("MP_SANDBOX_SET_PAYER_EMAIL") ?? "").trim().toLowerCase() === "1";

  // En sandbox, por defecto NO fijamos payer: permite pagar como invitado con tarjeta APRO.
  // Si MP_SANDBOX_SET_PAYER_EMAIL=1, se usa el email del comprador de prueba.
  let payer: { email: string } | undefined;
  if (sandbox && forceSandboxPayer && sandboxBuyerEmail) {
    payer = { email: sandboxBuyerEmail };
  } else if (!sandbox && params.payerEmail) {
    payer = { email: params.payerEmail };
  }

  const supabaseBase = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const httpsReturn = `${supabaseBase}/functions/v1/mp_retorno`;
  const retQ = new URLSearchParams();
  if (params.orderId) retQ.set("material_order_id", params.orderId);
  if (params.contratacionId) retQ.set("contratacion_id", params.contratacionId);
  const retQs = retQ.toString();
  const httpsSuccess = `${httpsReturn}?yc_status=approved${retQs ? `&${retQs}` : ""}`;
  const httpsFailure = `${httpsReturn}?yc_status=failure${retQs ? `&${retQs}` : ""}`;
  const httpsPending = `${httpsReturn}?yc_status=pending${retQs ? `&${retQs}` : ""}`;

  // Preferir HTTPS propio (no mercadopago.com.ar). Deep link solo si MP_USE_APP_BACK_URLS=1.
  const useAppBack =
    (Deno.env.get("MP_USE_APP_BACK_URLS") ?? "").trim().toLowerCase() === "1";
  const scheme = getAppReturnBase();
  const q = new URLSearchParams();
  if (params.orderId) q.set("material_order_id", params.orderId);
  if (params.contratacionId) q.set("contratacion_id", params.contratacionId);
  const qs = q.toString();
  const appSuccess = `${scheme}://pagos/retorno?status=approved${qs ? `&${qs}` : ""}`;
  const appFailure = `${scheme}://pagos/retorno?status=failure${qs ? `&${qs}` : ""}`;
  const appPending = `${scheme}://pagos/retorno?status=pending${qs ? `&${qs}` : ""}`;

  const preferenceMetadata: Record<string, unknown> = {
    source: params.orderId ? "mp_crear_preferencia_materiales" : "mp_crear_preferencia",
    ...(params.orderId ? { material_order_id: params.orderId } : {}),
    ...(params.contratacionId ? { contratacion_id: params.contratacionId } : {}),
    ...(params.paymentGroupId ? { payment_group_id: params.paymentGroupId } : {}),
    ...(params.checkoutId ? { checkout_id: params.checkoutId } : {}),
    ...(params.metadata ?? {}),
  };

  const body: Record<string, unknown> = {
    items: [
      {
        id: params.orderId ? `mat-${params.orderId.slice(0, 8)}` : "yachanga-fee",
        title: params.title,
        description: params.title,
        quantity: 1,
        unit_price: Number(params.amount),
        currency_id: "ARS",
      },
    ],
    external_reference: params.externalReference,
    metadata: preferenceMetadata,
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }],
      installments: 1,
      default_installments: 1,
    },
    binary_mode: false,
    back_urls: useAppBack
      ? { success: appSuccess, failure: appFailure, pending: appPending }
      : { success: httpsSuccess, failure: httpsFailure, pending: httpsPending },
    auto_return: "approved",
    notification_url: notificationUrl,
    statement_descriptor: "YACHANGA",
  };

  if (payer) {
    body.payer = payer;
  }

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`mp_preference_failed:${res.status}:${txt}`);
  }
  return JSON.parse(txt) as MpPreferenceResponse;
}

export type MpPayment = {
  id: number | string;
  status: string;
  transaction_amount?: number;
  external_reference?: string;
  preference_id?: string;
};

async function mpPaymentSearch(params: Record<string, string>): Promise<MpPayment[]> {
  const token = getMpAccessToken();
  if (!token) throw new Error("mp_not_configured");

  const url = new URL("https://api.mercadopago.com/v1/payments/search");
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");
  url.searchParams.set("range", "date_created");
  url.searchParams.set("begin_date", "NOW-60DAYS");
  url.searchParams.set("end_date", "NOW");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`mp_payment_search_failed:${res.status}:${txt}`);
  }
  const data = JSON.parse(txt) as { results?: MpPayment[] };
  return data.results ?? [];
}

export async function fetchMpPayment(paymentId: string): Promise<MpPayment> {
  const token = getMpAccessToken();
  if (!token) throw new Error("mp_not_configured");

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`mp_payment_fetch_failed:${res.status}:${txt}`);
  }
  return JSON.parse(txt) as MpPayment;
}

export async function searchMpPaymentsByExternalReference(
  externalReference: string,
): Promise<MpPayment[]> {
  return mpPaymentSearch({ external_reference: externalReference });
}

type MpMerchantOrder = {
  external_reference?: string;
  preference_id?: string;
  payments?: Array<{
    id?: number | string;
    status?: string;
    transaction_amount?: number;
  }>;
};

/** MP no filtra pagos por preference_id en /v1/payments/search; usa merchant_orders. */
export async function searchMpPaymentsByPreferenceId(
  preferenceId: string,
): Promise<MpPayment[]> {
  const token = getMpAccessToken();
  if (!token) throw new Error("mp_not_configured");

  const url = new URL("https://api.mercadopago.com/merchant_orders/search");
  url.searchParams.set("preference_id", preferenceId);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`mp_merchant_order_search_failed:${res.status}:${txt}`);
  }

  const data = JSON.parse(txt) as { elements?: MpMerchantOrder[] };
  const paymentIds = new Set<string>();

  for (const order of data.elements ?? []) {
    for (const p of order.payments ?? []) {
      if (p.id != null) paymentIds.add(String(p.id));
    }
  }

  const results: MpPayment[] = [];
  for (const id of paymentIds) {
    try {
      results.push(await fetchMpPayment(id));
    } catch {
      /* seguir con otros ids */
    }
  }
  return results;
}

export async function resolvePaymentContext(
  payment: MpPayment,
): Promise<PaymentConfirmContext | null> {
  const externalReference = String(payment.external_reference ?? "").trim();
  const parsed = parseExternalReference(externalReference);
  if (parsed) {
    return {
      contratacionId: parsed.contratacionId,
      orderId: parsed.orderId,
      tipoPago: parsed.tipoPago,
      externalReference:
        externalReference ||
        (parsed.orderId
          ? buildMaterialOrderExternalReference(parsed.orderId)
          : parsed.contratacionId
            ? buildExternalReference(parsed.contratacionId, parsed.tipoPago)
            : ""),
    };
  }

  const sb = createAdminClient();
  const prefId = payment.preference_id ? String(payment.preference_id) : null;

  if (prefId) {
    const { data: tx } = await sb
      .from("transacciones_pago")
      .select("contratacion_id, material_order_id, tipo_pago, external_reference")
      .eq("mp_preference_id", prefId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tx?.tipo_pago) {
      return {
        contratacionId: tx.contratacion_id ? String(tx.contratacion_id) : undefined,
        orderId: tx.material_order_id ? String(tx.material_order_id) : undefined,
        tipoPago: tx.tipo_pago as TipoPagoMp,
        externalReference: tx.external_reference,
      };
    }
  }

  const mpId = payment.id != null ? String(payment.id) : null;
  if (mpId) {
    const { data: tx } = await sb
      .from("transacciones_pago")
      .select("contratacion_id, material_order_id, tipo_pago, external_reference")
      .eq("mp_payment_id", mpId)
      .limit(1)
      .maybeSingle();

    if (tx?.tipo_pago) {
      return {
        contratacionId: tx.contratacion_id ? String(tx.contratacion_id) : undefined,
        orderId: tx.material_order_id ? String(tx.material_order_id) : undefined,
        tipoPago: tx.tipo_pago as TipoPagoMp,
        externalReference: tx.external_reference,
      };
    }
  }

  return null;
}

export type PaymentConfirmContext = {
  contratacionId?: string;
  orderId?: string;
  tipoPago: TipoPagoMp;
  externalReference: string;
};

export type CreditResult = {
  outcome: "processed" | "skipped";
  reason?: string;
};

function ceilMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function isPaymentAlreadyCredited(paymentId: string): Promise<boolean> {
  const id = safeId(paymentId);
  if (!id) return false;
  const sb = createAdminClient();
  const { data: byPayment, error: payErr } = await sb
    .from("transacciones_pago")
    .select("id")
    .eq("estado_mp", "approved")
    .eq("mp_payment_id", id)
    .limit(1);
  if (!payErr && (byPayment ?? []).length > 0) return true;

  const { data: byKey, error: keyErr } = await sb
    .from("transacciones_pago")
    .select("id")
    .eq("estado_mp", "approved")
    .eq("idempotency_key", `mp_payment:${id}`)
    .limit(1);
  if (keyErr) return false;
  return (byKey ?? []).length > 0;
}

async function loadExpectedFee(
  payment: MpPayment,
  ctx: PaymentConfirmContext,
): Promise<ExpectedFeeTarget | null> {
  const sb = createAdminClient();
  const ref = String(payment.external_reference ?? ctx.externalReference ?? "").trim();
  const parsed = parseExternalReference(ref);
  const contratacionId = parsed?.contratacionId ?? ctx.contratacionId;
  const orderId = parsed?.orderId ?? ctx.orderId;

  if (orderId) {
    const { data: order, error } = await sb
      .from("orders")
      .select("id, deposit_amount, payment_group_id")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !order) return null;

    const groupId = (order.payment_group_id as string | null) ?? null;
    let groupOrderIds = [String(order.id)];
    let amount = ceilMoney(Number(order.deposit_amount) || 0);

    if (groupId) {
      const { data: siblings } = await sb
        .from("orders")
        .select("id, deposit_amount")
        .eq("payment_group_id", groupId);
      if (siblings?.length) {
        groupOrderIds = siblings.map((s) => String(s.id));
        const siblingAmount = ceilMoney(Number(siblings[0]?.deposit_amount) || 0);
        if (siblingAmount > 0) amount = siblingAmount;
      }
      const { data: checkout } = await sb
        .from("material_checkouts")
        .select("service_fee")
        .eq("id", groupId)
        .maybeSingle();
      const fee = ceilMoney(Number(checkout?.service_fee) || 0);
      if (fee > 0) amount = fee;
    }

    const { data: txs } = await sb
      .from("transacciones_pago")
      .select("monto, external_reference")
      .in("material_order_id", groupOrderIds)
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = txs ?? [];
    const matchRow = rows.find((r) => String(r.external_reference ?? "") === ref);
    if (matchRow && Number(matchRow.monto) > 0) {
      amount = Number(matchRow.monto);
    }

    return {
      amount,
      externalReference: String(matchRow?.external_reference ?? "") ||
        buildMaterialOrderExternalReference(orderId),
      orderId: String(order.id),
      paymentGroupId: groupId,
      groupOrderIds,
    };
  }

  if (!contratacionId) return null;

  const { data: row, error } = await sb
    .from("contrataciones")
    .select("id, comision_app")
    .eq("id", contratacionId)
    .maybeSingle();
  if (error || !row) return null;

  let amount = ceilMoney(Number(row.comision_app) || 0);
  const { data: txs } = await sb
    .from("transacciones_pago")
    .select("monto, external_reference, estado_mp, tipo_pago")
    .eq("contratacion_id", contratacionId)
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = txs ?? [];
  const matchRow = rows.find((r) => String(r.external_reference ?? "") === ref);
  if (matchRow && Number(matchRow.monto) > 0) {
    amount = Number(matchRow.monto);
  } else if ((parsed?.tipoPago ?? ctx.tipoPago) === "diferencia_seña") {
    const paid = rows
      .filter((r) => r.estado_mp === "approved")
      .reduce((acc, r) => acc + Number(r.monto ?? 0), 0);
    amount = ceilMoney(Math.max(Number(row.comision_app) - paid, 0));
  }

  return {
    amount,
    externalReference:
      String(matchRow?.external_reference ?? "") ||
      ref ||
      buildExternalReference(contratacionId, parsed?.tipoPago ?? ctx.tipoPago),
    contratacionId,
  };
}

export async function searchMpApprovedPaymentsForContratacion(
  contratacionId: string,
): Promise<MpPayment[]> {
  const seen = new Set<string>();
  const out: MpPayment[] = [];
  const tipos: TipoPagoMp[] = ["seña_inicial", "diferencia_seña"];

  for (const tipo of tipos) {
    const ref = buildExternalReference(contratacionId, tipo);
    try {
      const rows = await searchMpPaymentsByExternalReference(ref);
      for (const p of rows) {
        const id = String(p.id);
        if (!seen.has(id)) {
          seen.add(id);
          out.push(p);
        }
      }
    } catch {
      /* seguir */
    }
  }

  const sb = createAdminClient();
  const { data: txs } = await sb
    .from("transacciones_pago")
    .select("mp_preference_id")
    .eq("contratacion_id", contratacionId)
    .not("mp_preference_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);

  for (const tx of txs ?? []) {
    const prefId = (tx as { mp_preference_id?: string }).mp_preference_id;
    if (!prefId) continue;
    try {
      const rows = await searchMpPaymentsByPreferenceId(prefId);
      for (const p of rows) {
        const id = String(p.id);
        if (!seen.has(id)) {
          seen.add(id);
          out.push(p);
        }
      }
    } catch {
      /* seguir */
    }
  }

  try {
    const recent = await mpPaymentSearch({ status: "approved" });
    for (const p of recent) {
      const ref = String(p.external_reference ?? "");
      if (!ref.includes(contratacionId)) continue;
      const id = String(p.id);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(p);
      }
    }
  } catch {
    /* seguir */
  }

  return out.filter((p) => String(p.status ?? "").toLowerCase() === "approved");
}

export async function findApprovedMpPayment(ctx: PaymentConfirmContext): Promise<MpPayment | null> {
  const seen = new Set<string>();
  const candidates: MpPayment[] = [];

  const refs = new Set<string>();
  if (ctx.externalReference) refs.add(ctx.externalReference);
  if (ctx.orderId) {
    refs.add(buildMaterialOrderExternalReference(ctx.orderId));
  }
  if (ctx.contratacionId) {
    refs.add(buildExternalReference(ctx.contratacionId, ctx.tipoPago));
    refs.add(`contratacion_id:${ctx.contratacionId}|tipo_pago:${ctx.tipoPago}`);
  }

  for (const ref of refs) {
    try {
      const rows = await searchMpPaymentsByExternalReference(ref);
      for (const p of rows) {
        const id = String(p.id);
        if (!seen.has(id)) {
          seen.add(id);
          candidates.push(p);
        }
      }
    } catch {
      /* intentar otros métodos */
    }
  }

  return candidates.find((p) => String(p.status ?? "").toLowerCase() === "approved") ?? null;
}

export async function processApprovedMpPayment(
  payment: MpPayment,
  ctx?: PaymentConfirmContext,
): Promise<CreditResult> {
  const parsed = parseExternalReference(String(payment.external_reference ?? ""));
  const contratacionId = parsed?.contratacionId ?? ctx?.contratacionId;
  const orderId = parsed?.orderId ?? ctx?.orderId;
  const tipoPago = parsed?.tipoPago ?? ctx?.tipoPago;
  const externalReference = String(
    payment.external_reference ?? ctx?.externalReference ?? "",
  ).trim();

  const status = String(payment.status ?? "").toLowerCase();
  if (status !== "approved") return { outcome: "skipped", reason: "not_approved" };

  if (await isPaymentAlreadyCredited(String(payment.id ?? ""))) {
    return { outcome: "skipped", reason: "already_credited" };
  }

  const confirmCtx: PaymentConfirmContext = {
    contratacionId,
    orderId,
    tipoPago: tipoPago ?? ctx?.tipoPago ?? "seña_inicial",
    externalReference,
  };
  const expected = await loadExpectedFee(payment, confirmCtx);
  if (!expected) return { outcome: "skipped", reason: "fee_target_missing" };

  const match = paymentMatchesExpectedFee(
    {
      status,
      transactionAmount: Number(payment.transaction_amount ?? NaN),
      externalReference,
    },
    expected,
  );
  if (!match.ok) return { outcome: "skipped", reason: match.reason };

  const sb = createAdminClient();
  const idempotencyKey = `mp_payment:${payment.id}`;

  if (orderId && (tipoPago === "seña_materiales" || !contratacionId)) {
    const { error } = await sb.rpc("registrar_sena_material_aprobada", {
      p_order_id: orderId,
      p_monto: Number(payment.transaction_amount ?? 0),
      p_mp_payment_id: String(payment.id),
      p_mp_preference_id: payment.preference_id ? String(payment.preference_id) : null,
      p_idempotency_key: idempotencyKey,
      p_external_reference:
        externalReference || buildMaterialOrderExternalReference(orderId),
    });
    if (error) throw new Error(`registrar_sena_material_failed:${error.message}`);

    // Push al comercio: solo vía enqueue_store_push → store_push_events → webhook
    // push_on_store_board (sin backup directo a Expo; evita duplicados).

    return { outcome: "processed" };
  }

  if (!contratacionId || !tipoPago) return { outcome: "skipped", reason: "fee_target_missing" };

  const { error } = await sb.rpc("registrar_seña_aprobada", {
    p_contratacion_id: contratacionId,
    p_tipo_pago: tipoPago,
    p_monto: Number(payment.transaction_amount ?? 0),
    p_mp_payment_id: String(payment.id),
    p_mp_preference_id: payment.preference_id ? String(payment.preference_id) : null,
    p_idempotency_key: idempotencyKey,
    p_external_reference: externalReference || buildExternalReference(contratacionId, tipoPago),
  });

  if (error) throw new Error(`registrar_seña_failed:${error.message}`);
  return { outcome: "processed" };
}
