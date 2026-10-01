import {
  parseExternalReference,
  paymentGroupIdFromReference,
  // Deno exige el sufijo .ts. El tsc de la app no lo permite.
  // @ts-expect-error TS5097
} from "./mpReference.ts";

/** MP: si data.id es alfanumérico va en minúsculas; si es solo dígitos, se deja. */
export function normalizeMpDataId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  if (/[a-z]/i.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

export function buildMpSignatureManifest(
  dataId: string,
  requestId: string,
  ts: string,
): string {
  return `id:${normalizeMpDataId(dataId)};request-id:${requestId};ts:${ts};`;
}

export function parseMpXSignature(
  header: string | null | undefined,
): { ts: string; v1: string } | null {
  const raw = (header ?? "").trim();
  if (!raw) return null;
  let ts = "";
  let v1 = "";
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Firma de webhooks de Mercado Pago (header x-signature, esquema ts/v1).
 * Manifest: `id:{data.id};request-id:{x-request-id};ts:{ts};`
 */
export async function verifyMpWebhookSignature(params: {
  secret: string;
  dataId: string;
  xSignature: string | null;
  xRequestId: string | null;
}): Promise<boolean> {
  const secret = params.secret.trim();
  if (!secret) return false;
  const requestId = (params.xRequestId ?? "").trim();
  const parsed = parseMpXSignature(params.xSignature);
  if (!requestId || !parsed || !params.dataId.trim()) return false;
  const manifest = buildMpSignatureManifest(params.dataId, requestId, parsed.ts);
  const computed = await hmacSha256Hex(secret, manifest);
  return timingSafeEqual(computed.toLowerCase(), parsed.v1.toLowerCase());
}

/** 503 si el secreto no está configurado. La firma inválida la resuelve el caller con 401. */
export function mpWebhookSecretStatus(secret: string | null | undefined): 503 | null {
  return (secret ?? "").trim() ? null : 503;
}

export function moneyEquals(paid: number, expected: number): boolean {
  if (!Number.isFinite(paid) || !Number.isFinite(expected)) return false;
  if (expected <= 0 || paid <= 0) return false;
  return Math.round(paid * 100) === Math.round(expected * 100);
}

export type ExpectedFeeTarget = {
  amount: number;
  /** Referencia guardada al crear la preferencia, si existe. */
  externalReference?: string;
  orderId?: string;
  contratacionId?: string;
  paymentGroupId?: string | null;
  /** Órdenes del mismo material_checkouts / payment_group, incluida la principal. */
  groupOrderIds?: string[];
};

export type PaymentMatchInput = {
  status?: string | null;
  transactionAmount?: number | null;
  externalReference?: string | null;
};

export type PaymentMatchResult =
  | { ok: true }
  | { ok: false; reason: "not_approved" | "amount_mismatch" | "reference_mismatch" };

/**
 * Acredita solo si el pago reconsultado está approved, el monto es el fee
 * esperado y external_reference apunta a la contratación, la orden o una
 * orden del mismo payment_group.
 */
export function paymentMatchesExpectedFee(
  payment: PaymentMatchInput,
  expected: ExpectedFeeTarget,
): PaymentMatchResult {
  const status = String(payment.status ?? "").trim().toLowerCase();
  if (status !== "approved") return { ok: false, reason: "not_approved" };

  const paid = Number(payment.transactionAmount);
  if (!moneyEquals(paid, expected.amount)) {
    return { ok: false, reason: "amount_mismatch" };
  }

  if (!referenceMatchesExpected(String(payment.externalReference ?? ""), expected)) {
    return { ok: false, reason: "reference_mismatch" };
  }
  return { ok: true };
}

export function referenceMatchesExpected(
  externalReference: string,
  expected: ExpectedFeeTarget,
): boolean {
  const ref = externalReference.trim();
  if (!ref) return false;

  const expectedRef = (expected.externalReference ?? "").trim();
  if (expectedRef && ref === expectedRef) return true;

  const parsed = parseExternalReference(ref);
  const groupFromRef = paymentGroupIdFromReference(ref);
  const groupIds = new Set(
    (expected.groupOrderIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  if (expected.orderId) groupIds.add(expected.orderId.trim());

  if (parsed?.contratacionId) {
    return Boolean(expected.contratacionId) && parsed.contratacionId === expected.contratacionId;
  }

  if (parsed?.orderId) {
    if (groupIds.has(parsed.orderId)) return true;
    return false;
  }

  if (
    groupFromRef &&
    expected.paymentGroupId &&
    groupFromRef === expected.paymentGroupId
  ) {
    return true;
  }

  return false;
}
