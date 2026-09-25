/** Texto útil para logs cuando el inicio de pago de materiales falla. */
export function paymentStartCause(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'object' && error) {
    const row = error as Record<string, unknown>;
    const parts = ['error', 'message', 'details', 'detail', 'hint', 'code']
      .map((key) => {
        const value = row[key];
        return typeof value === 'string' ? value.trim() : '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' | ');
  }
  return '';
}

/**
 * Mensaje corto para el toast. La causa cruda queda en `cause` para el log;
 * no se descarta un objeto de error de Supabase o de Mercado Pago.
 */
export function describePaymentStartFailure(
  error: unknown,
  fallback = 'No se pudo iniciar el pago.',
): { userMessage: string; cause: string } {
  const cause = paymentStartCause(error);
  if (!cause) return { userMessage: fallback, cause: fallback };

  if (/column .+ does not exist|schema cache|42703/i.test(cause)) {
    return {
      userMessage: 'No se pudo preparar el pedido para el pago.',
      cause,
    };
  }

  const mpStatus = cause.match(/mp_preference_failed:(\d{3})/i)?.[1];
  if (/mp_preference_failed|mp_missing_checkout_url/i.test(cause)) {
    return {
      userMessage: mpStatus
        ? `Mercado Pago rechazó el inicio del pago (${mpStatus}).`
        : 'Mercado Pago rechazó el inicio del pago.',
      cause,
    };
  }

  if (/order_not_awaiting_deposit|already_paid|monto_cero/i.test(cause)) {
    return {
      userMessage: 'Esta orden no está pendiente de pago.',
      cause,
    };
  }

  if (/^edge function returned a non-2xx/i.test(cause) && !/mp_|order_|column /i.test(cause)) {
    return { userMessage: fallback, cause };
  }

  if (cause.length <= 180 && !/^[{[]/.test(cause)) {
    return { userMessage: cause, cause };
  }

  return { userMessage: fallback, cause };
}
