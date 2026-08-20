import { useEffect } from 'react';
import { Linking } from 'react-native';
import { parsePagoRetornoUrl } from '../services/pagosMercadoPago';
import { openPagoRetorno } from './openPagoCheckout';

/**
 * Deep link de respaldo para retornos MP fuera del WebView.
 * El flujo principal usa WebView en `PagoCheckoutScreen`.
 */
export function usePagoRetornoDeepLink(contratacionIdHint?: string, materialOrderIdHint?: string) {
  useEffect(() => {
    const handle = (url: string) => {
      const parsed = parsePagoRetornoUrl(url);
      if (parsed.status === 'unknown') return;
      const status =
        parsed.status === 'approved' || parsed.status === 'pending' || parsed.status === 'failure'
          ? parsed.status
          : 'pending';

      const materialOrderId = parsed.materialOrderId ?? materialOrderIdHint;
      if (materialOrderId) {
        openPagoRetorno({
          materialOrderId,
          status,
          mpPaymentId: parsed.mpPaymentId,
        });
        return;
      }

      const contratacionId = parsed.contratacionId ?? contratacionIdHint;
      if (!contratacionId) return;

      openPagoRetorno({
        contratacionId,
        status,
        mpPaymentId: parsed.mpPaymentId,
      });
    };

    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    void Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    return () => sub.remove();
  }, [contratacionIdHint, materialOrderIdHint]);
}
