/**
 * Mientras el usuario está en checkout / retorno de Mercado Pago (WebView o
 * navegador), AppState "active" y getUser() pueden fallar un instante y
 * disparar un falso "cuenta no disponible". Pausamos la expulsión forzada.
 */
let paymentFlowDepth = 0;

export function beginPaymentSessionGuard(): void {
  paymentFlowDepth += 1;
}

export function endPaymentSessionGuard(): void {
  paymentFlowDepth = Math.max(0, paymentFlowDepth - 1);
}

export function isPaymentSessionGuarded(): boolean {
  return paymentFlowDepth > 0;
}
