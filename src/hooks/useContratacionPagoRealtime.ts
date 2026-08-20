import { useEffect, useRef, useState } from 'react';
import {
  fetchContratacionById,
  subscribeContratacionById,
} from '../services/contratacionesSupabase';
import { confirmarSeñaMercadoPago } from '../services/pagosMercadoPago';
import type { ContratacionEstadoPago } from '../types/contrataciones';

const DEFAULT_TIMEOUT_MS = 120_000;
const FALLBACK_SYNC_MS = 2_000;
const POLL_SYNC_MS = 2_500;

export function isSeñaAcreditada(estado: string | null | undefined): boolean {
  return estado === 'seña_pagada' || estado === 'totalmente_pagado';
}

type Options = {
  enabled?: boolean;
  timeoutMs?: number;
  /** Consulta MP una vez si el webhook tarda (sin botón manual). */
  enableMpFallback?: boolean;
  mpPaymentId?: string;
  onConfirmed?: (estadoPago: ContratacionEstadoPago) => void;
};

/**
 * Escucha cambios en `contrataciones.estado_pago` vía Supabase Realtime.
 * El webhook de Mercado Pago actualiza la fila; la UI reacciona sin polling ni botón manual.
 */
export function useContratacionPagoRealtime(
  contratacionId: string | null | undefined,
  options?: Options,
): {
  waiting: boolean;
  confirmed: boolean;
  estadoPago: ContratacionEstadoPago | null;
  timedOut: boolean;
} {
  const enabled = options?.enabled !== false;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const enableMpFallback = options?.enableMpFallback !== false;
  const mpPaymentId = options?.mpPaymentId;
  const onConfirmed = options?.onConfirmed;

  const [waiting, setWaiting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [estadoPago, setEstadoPago] = useState<ContratacionEstadoPago | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const handledRef = useRef(false);

  useEffect(() => {
    handledRef.current = false;
    setWaiting(false);
    setConfirmed(false);
    setEstadoPago(null);
    setTimedOut(false);

    if (!enabled || !contratacionId) return;

    let cancelled = false;

    const markConfirmed = (estado: ContratacionEstadoPago) => {
      if (cancelled || handledRef.current) return;
      if (!isSeñaAcreditada(estado)) return;
      handledRef.current = true;
      setEstadoPago(estado);
      setConfirmed(true);
      setWaiting(false);
      setTimedOut(false);
      onConfirmed?.(estado);
    };

    setWaiting(true);

    void fetchContratacionById(contratacionId)
      .then((row) => {
        if (cancelled || !row) return;
        setEstadoPago(row.estado_pago);
        markConfirmed(row.estado_pago);
      })
      .catch(() => {});

    const unsub = subscribeContratacionById(contratacionId, (row) => {
      if (cancelled) return;
      setEstadoPago(row.estado_pago);
      markConfirmed(row.estado_pago);
    });

    const runMpFallback = () => {
      if (cancelled || handledRef.current) return;
      void confirmarSeñaMercadoPago(contratacionId, mpPaymentId)
        .then(async () => {
          if (cancelled || handledRef.current) return;
          const row = await fetchContratacionById(contratacionId);
          if (row) {
            setEstadoPago(row.estado_pago);
            markConfirmed(row.estado_pago);
          }
        })
        .catch(() => {});
    };

    if (enableMpFallback) {
      runMpFallback();
    }

    const fallbackTimer = enableMpFallback ? setTimeout(runMpFallback, FALLBACK_SYNC_MS) : null;
    const pollInterval = enableMpFallback ? setInterval(runMpFallback, POLL_SYNC_MS) : null;

    const timer = setTimeout(() => {
      if (cancelled || handledRef.current) return;
      setWaiting(false);
      setTimedOut(true);
    }, timeoutMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (pollInterval) clearInterval(pollInterval);
      unsub();
    };
  }, [contratacionId, enableMpFallback, enabled, mpPaymentId, onConfirmed, timeoutMs]);

  return { waiting, confirmed, estadoPago, timedOut };
}
