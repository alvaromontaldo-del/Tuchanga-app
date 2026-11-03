/** Helpers puros de la suscripción de prueba. Sin Deno ni secretos. */

const EMAIL_RE = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g;

export const SUBSCRIPTION_PAYER_MISSING = {
  error: "payer_email_missing" as const,
  message: "Falta configurar el comprador de prueba de Mercado Pago.",
};

export type SubscriptionPayer =
  | { email: string }
  | typeof SUBSCRIPTION_PAYER_MISSING;

/**
 * Checkout de preapproval. En sandbox MP devuelve `init_point`
 * (sandbox_init_point es de preferences, no de suscripciones).
 */
export function resolvePreapprovalCheckoutUrl(
  created: {
    init_point?: string | null;
    sandbox_init_point?: string | null;
  } | null | undefined,
): string {
  if (!created) return "";
  return (created.init_point ?? created.sandbox_init_point ?? "").trim();
}

/**
 * En sandbox el payer es solo el comprador de prueba.
 * No acepta el mail real: si el secreto está vacío, hay que fallar.
 */
export function resolveSubscriptionPayerEmail(
  sandboxBuyerEmail: string | null | undefined,
): SubscriptionPayer {
  const email = (sandboxBuyerEmail ?? "").trim();
  if (!email) return SUBSCRIPTION_PAYER_MISSING;
  return { email };
}

export function redactMpLogText(value: string): string {
  return value.replace(EMAIL_RE, "[redacted]");
}

/** status + message + cause[].code, sin mail ni token. */
export function mpFailureLogFields(
  status: number,
  bodyText: string,
): { status: number; message: string; causeCodes: string[] } {
  let message = "";
  const causeCodes: string[] = [];
  try {
    const parsed = JSON.parse(bodyText) as {
      message?: unknown;
      cause?: unknown;
    };
    if (typeof parsed.message === "string") message = redactMpLogText(parsed.message);
    if (Array.isArray(parsed.cause)) {
      for (const item of parsed.cause) {
        if (!item || typeof item !== "object") continue;
        const code = (item as { code?: unknown }).code;
        if (code == null) continue;
        const text = redactMpLogText(String(code).trim());
        if (text) causeCodes.push(text);
      }
    }
  } catch {
    /* cuerpo que no es JSON */
  }
  return { status, message, causeCodes };
}

/** Claves de la respuesta de MP, nunca los valores. */
export function preapprovalResponseKeys(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.keys(body as Record<string, unknown>);
}

/** Retorno de suscripción: no hay orden ni contratación que acreditar. */
export function isStoreSubscriptionReturn(params: {
  storeSubscription: string | null | undefined;
  materialOrderId: string | null | undefined;
  contratacionId: string | null | undefined;
}): boolean {
  return (
    (params.storeSubscription ?? "").trim() === "1" &&
    !(params.materialOrderId ?? "").trim() &&
    !(params.contratacionId ?? "").trim()
  );
}

export function storeSubscriptionAppReturnUrl(scheme: string, status: string): string {
  const base = (scheme || "tuchanga-app").replace(/\/$/, "");
  const safe = status === "approved" || status === "pending" || status === "failure"
    ? status
    : "pending";
  return `${base}://pagos/retorno?status=${safe}&store_subscription=1`;
}
