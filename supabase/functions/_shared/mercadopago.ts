import { createAdminClient } from "./supabaseAdmin.ts";
import { sendExpoPush } from "./expoPush.ts";

/** Valores del enum Postgres `transaccion_tipo_pago`. */
export type TipoPagoMp = "seña_inicial" | "diferencia_seña" | "seña_materiales";

/** Códigos ASCII en external_reference (sin ñ — MP los corrompe en búsquedas). */
export type TipoPagoMpRef = "sena_inicial" | "diferencia_sena" | "sena_materiales";

export type ParsedExternalReference = {
  contratacionId?: string;
  orderId?: string;
  tipoPago: TipoPagoMp;
};

export function tipoPagoToRef(tipo: TipoPagoMp): TipoPagoMpRef {
  if (tipo === "seña_inicial") return "sena_inicial";
  if (tipo === "diferencia_seña") return "diferencia_sena";
  return "sena_materiales";
}

export function tipoPagoFromRef(raw: string): TipoPagoMp | null {
  if (raw === "sena_inicial" || raw === "seña_inicial") return "seña_inicial";
  if (raw === "diferencia_sena" || raw === "diferencia_seña") return "diferencia_seña";
  if (raw === "sena_materiales" || raw === "seña_materiales") return "seña_materiales";
  return null;
}

export function buildExternalReference(
  contratacionId: string,
  tipoPago: TipoPagoMp,
): string {
  return `contratacion_id:${contratacionId}|tipo_pago:${tipoPagoToRef(tipoPago)}`;
}

export function buildMaterialOrderExternalReference(orderId: string): string {
  return `order_id:${orderId}|tipo_pago:sena_materiales`;
}

export function parseExternalReference(ref: string): ParsedExternalReference | null {
  const parts = ref.split("|").map((p) => p.trim());
  let contratacionId: string | undefined;
  let orderId: string | undefined;
  let tipoPago: TipoPagoMp | null = null;
  for (const part of parts) {
    if (part.startsWith("contratacion_id:")) {
      contratacionId = part.slice("contratacion_id:".length);
    }
    if (part.startsWith("order_id:")) {
      orderId = part.slice("order_id:".length);
    }
    if (part.startsWith("tipo_pago:")) {
      const raw = part.slice("tipo_pago:".length);
      tipoPago = tipoPagoFromRef(raw);
    }
  }
  if (!tipoPago) return null;
  if (!contratacionId && !orderId) return null;
  return { contratacionId, orderId, tipoPago };
}

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
): Promise<"processed" | "skipped"> {
  const parsed = parseExternalReference(String(payment.external_reference ?? ""));
  const contratacionId = parsed?.contratacionId ?? ctx?.contratacionId;
  const orderId = parsed?.orderId ?? ctx?.orderId;
  const tipoPago = parsed?.tipoPago ?? ctx?.tipoPago;
  const externalReference = String(
    payment.external_reference ?? ctx?.externalReference ?? "",
  ).trim();

  const status = String(payment.status ?? "").toLowerCase();
  if (status !== "approved") return "skipped";

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

    // Backup push al comercio (además de store_push_events + webhook).
    try {
      const { data: ord } = await sb
        .from("orders")
        .select("order_code, quotes!inner ( store_id )")
        .eq("id", orderId)
        .maybeSingle();
      const qRel = (ord as { quotes?: { store_id?: string } | { store_id?: string }[] } | null)
        ?.quotes;
      const storeId = Array.isArray(qRel) ? qRel[0]?.store_id : qRel?.store_id;
      if (storeId) {
        const { data: store } = await sb
          .from("stores")
          .select("user_id")
          .eq("id", storeId)
          .maybeSingle();
        if (store?.user_id) {
          const { data: prof } = await sb
            .from("profiles")
            .select("expo_push_token")
            .eq("id", store.user_id)
            .maybeSingle();
          if (prof?.expo_push_token) {
            const code = String((ord as { order_code?: string } | null)?.order_code ?? "");
            await sendExpoPush({
              to: prof.expo_push_token,
              title: "YaChanga",
              body: code
                ? `Pedido confirmado: el cliente pagó el costo de servicio. Prepará el pedido ${code}.`
                : "Pedido confirmado: el cliente pagó el costo de servicio.",
              data: {
                type: "store_board",
                column: "confirmadas",
                orderId,
                orderCode: code || null,
                storeId,
              },
            });
          }
        }
      }
    } catch {
      /* no bloquea el acreditado */
    }

    return "processed";
  }

  if (!contratacionId || !tipoPago) return "skipped";

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
  return "processed";
}
