/** Deep link de retorno post-checkout MP. */
export const PAGO_RETORNO_PATH = 'pagos/retorno';

export type MpNavResult = {
  status: 'approved' | 'pending' | 'failure';
  paymentId?: string;
};

export function extractMpPaymentId(url: string): string | null {
  try {
    const normalized = url.includes('://') ? url : `https://local.invalid/?${url.replace(/^\?/, '')}`;
    const u = new URL(normalized);
    const id =
      u.searchParams.get('payment_id') ??
      u.searchParams.get('collection_id') ??
      u.searchParams.get('payment-id');
    if (id && /^\d+$/.test(id)) return id;
  } catch {
    /* fallback regex */
  }
  const m = url.match(/[?&](?:payment_id|collection_id)=(\d+)/i);
  return m?.[1] ?? null;
}

export function getPagoRetornoDeepLink(status: 'approved' | 'pending' | 'failure' = 'approved'): string {
  const scheme = (process.env.EXPO_PUBLIC_APP_SCHEME ?? 'tuchanga-app').trim();
  return `${scheme}://${PAGO_RETORNO_PATH}?status=${status}`;
}

/** Detecta redirecciones de Checkout Pro dentro del WebView (sin auto_return HTTPS). */
export function parseMpWebViewNavigation(url: string): MpNavResult | null {
  const u = url.toLowerCase();
  const paymentId = extractMpPaymentId(url) ?? undefined;

  const scheme = (process.env.EXPO_PUBLIC_APP_SCHEME ?? 'tuchanga-app').trim().toLowerCase();
  const isAppReturn =
    u.includes(PAGO_RETORNO_PATH) ||
    u.includes('pagos/retorno') ||
    (scheme.length > 0 && u.startsWith(`${scheme}://`));

  const isHttpsReturn = u.includes('/functions/v1/mp_retorno') || u.includes('data-yc-mp-retorno');

  if (isAppReturn || isHttpsReturn) {
    if (u.includes('status=approved') || u.includes('collection_status=approved')) {
      return { status: 'approved', paymentId };
    }
    if (u.includes('approved') || u.includes('success')) return { status: 'approved', paymentId };
    if (u.includes('status=pending') || u.includes('collection_status=pending')) {
      return { status: 'pending', paymentId };
    }
    if (u.includes('pending') || u.includes('in_process')) return { status: 'pending', paymentId };
    if (u.includes('status=failure') || u.includes('collection_status=rejected')) {
      return { status: 'failure', paymentId };
    }
    if (u.includes('failure') || u.includes('rejected')) return { status: 'failure', paymentId };
    return null;
  }

  if (u.includes('collection_status=approved') || u.includes('yc_status=approved')) {
    return { status: 'approved', paymentId };
  }
  if (
    u.includes('collection_status=pending') ||
    u.includes('collection_status=in_process') ||
    u.includes('yc_status=pending')
  ) {
    return { status: 'pending', paymentId };
  }
  if (
    u.includes('collection_status=rejected') ||
    u.includes('collection_status=refused') ||
    u.includes('yc_status=failure')
  ) {
    return { status: 'failure', paymentId };
  }

  if (u.includes('mercadopago')) {
    if (
      u.includes('/congrats/approved') ||
      u.includes('payment_status=approved') ||
      (u.includes('/congrats') && (paymentId || u.includes('collection_id='))) ||
      (u.includes('/redirect') && u.includes('approved')) ||
      (u.includes('pago') && u.includes('acredit'))
    ) {
      return { status: 'approved', paymentId };
    }
    if (u.includes('/payment/redirect/success') && paymentId) {
      return { status: 'approved', paymentId };
    }
  }

  return null;
}

/** Script inyectado: detecta la pantalla de éxito de MP aunque no redirija al deep link. */
export const MP_CHECKOUT_SUCCESS_INJECTED_JS = `
(function () {
  var sent = false;
  function notify() {
    if (sent) return;
    sent = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mp_approved' }));
  }
  function check() {
    try {
      var href = String(location.href || '');
      if (/mp_retorno/i.test(href)) {
        var params = new URLSearchParams(location.search);
        var st = String(params.get('collection_status') || params.get('status') || params.get('yc_status') || '').toLowerCase();
        var pid = params.get('payment_id') || params.get('collection_id') || '';
        if (st === 'approved' || st === 'success') {
          sent = true;
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mp_retorno', status: 'approved', paymentId: pid }));
        }
        return;
      }
      var body = (document.body && document.body.innerText) ? document.body.innerText : '';
      if (/tu pago ya se acredit|pago ya se acredit|payment has been credited|¡listo!/i.test(body)
          && !/no pudimos procesar|algo salió mal/i.test(body)) {
        notify();
      }
    } catch (e) {}
  }
  check();
  setInterval(check, 700);
  try {
    if (document.body) {
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  } catch (e) {}
})();
true;
`;

/** Evita que el checkout abra la app nativa de MP (cuenta real en el dispositivo). */
export function shouldBlockMpExternalNavigation(url: string): boolean {
  const u = url.toLowerCase();
  if (u.startsWith('mercadopago://')) return true;
  if (u.startsWith('intent://') && u.includes('mercadopago')) return true;
  if (u.includes('market://') && u.includes('mercadopago')) return true;
  return false;
}

/**
 * Habilita botón de pago MP en la app.
 * Requiere además `MP_ACCESS_TOKEN` en secrets de Supabase Edge Functions.
 */
export function isMercadoPagoEnabled(): boolean {
  const raw = (process.env.EXPO_PUBLIC_MP_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export type MpCheckoutResult = {
  checkout_url: string;
  preference_id: string;
  monto: number;
  tipo_pago: 'seña_inicial' | 'diferencia_seña';
  external_reference: string;
  sandbox?: boolean;
};

export type MpCheckoutErrorCode =
  | 'mp_not_configured'
  | 'unauthorized'
  | 'forbidden_not_client'
  | 'estado_invalido'
  | 'monto_cero_usar_credito'
  | 'mp_sandbox_buyer_email_required'
  | 'unknown';

export function mapMpCheckoutError(body: unknown): MpCheckoutErrorCode {
  const code = typeof body === 'object' && body && 'error' in body
    ? String((body as { error?: string }).error ?? '')
    : '';
  if (code === 'mp_not_configured') return 'mp_not_configured';
  if (code === 'mp_sandbox_buyer_email_required') return 'mp_sandbox_buyer_email_required';
  if (code === 'unauthorized') return 'unauthorized';
  if (code === 'forbidden_not_client') return 'forbidden_not_client';
  if (code === 'monto_cero_usar_credito') return 'monto_cero_usar_credito';
  if (code.includes('estado')) return 'estado_invalido';
  return 'unknown';
}
