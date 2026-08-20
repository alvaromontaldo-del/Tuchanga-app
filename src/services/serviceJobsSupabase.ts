import type { Contratacion, ContratacionEstadoPago, ContratacionEstadoTrabajo } from '../types/contrataciones';
import {
  aceptarPrecioCotizado,
  aplicarSeñaConCredito,
  fetchLatestContratacionServicioByConversation,
  subscribeContratacionesByConversation,
  trabajadorFinalizarTrabajo,
} from './contratacionesSupabase';

export type JobWorkStatus = 'PENDING' | 'COMPLETED_BY_WORKER';
export type JobPaymentStatus = 'PENDING' | 'PAID';

export type ServiceJob = {
  id: string;
  conversation_id: string;
  quote_id: string;
  worker_id: string;
  client_id: string;
  amount: number;
  seña: number;
  description: string;
  estado_trabajo: ContratacionEstadoTrabajo;
  estado_pago: ContratacionEstadoPago;
  work_status: JobWorkStatus;
  payment_status: JobPaymentStatus;
  paid_at: string | null;
  offline_pago_notificado_at: string | null;
  offline_pago_confirmado_at: string | null;
  conformidad_aceptada: boolean | null;
  completed_by_worker_at: string | null;
  created_at: string;
  updated_at: string;
};

export function contratacionToServiceJob(c: Contratacion): ServiceJob {
  const work_status: JobWorkStatus =
    c.estado_trabajo === 'finalizado' || c.estado_trabajo === 'disputa'
      ? 'COMPLETED_BY_WORKER'
      : 'PENDING';
  const payment_status: JobPaymentStatus =
    c.estado_pago === 'pendiente_seña' ? 'PENDING' : 'PAID';

  return {
    id: c.id,
    conversation_id: c.conversation_id,
    quote_id: c.id,
    worker_id: c.worker_id,
    client_id: c.client_id,
    amount: c.precio_final,
    seña: c.comision_app,
    description: c.service_detail,
    estado_trabajo: c.estado_trabajo,
    estado_pago: c.estado_pago,
    work_status,
    payment_status,
    paid_at: c.seña_pagada_at ?? c.paid_at,
    offline_pago_notificado_at: c.offline_pago_notificado_at,
    offline_pago_confirmado_at: c.offline_pago_confirmado_at,
    conformidad_aceptada: c.conformidad_aceptada,
    completed_by_worker_at: c.completed_by_worker_at ?? c.finalizado_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

export async function fetchLatestJobByConversation(conversationId: string): Promise<ServiceJob | null> {
  const row = await fetchLatestContratacionServicioByConversation(conversationId);
  if (!row) return null;
  return contratacionToServiceJob(row);
}

export function subscribeJobsByConversation(
  conversationId: string,
  onUpsert: (job: ServiceJob) => void,
): () => void {
  return subscribeContratacionesByConversation(conversationId, (row) => {
    if (row.estado_trabajo === 'precio_cotizado' || row.estado_trabajo === 'cancelado') return;
    onUpsert(contratacionToServiceJob(row));
  });
}

/** Acepta el precio cotizado (antes accept_quote). Devuelve contratacion_id. */
export async function acceptQuoteCreateJob(contratacionId: string): Promise<string> {
  await aceptarPrecioCotizado(contratacionId);
  return contratacionId;
}

/** Paga seña con crédito (MP en Fase 2). */
export async function processPayment(contratacionId: string): Promise<void> {
  await aplicarSeñaConCredito(contratacionId);
}

/** Solicita conformidad del cliente (antes complete_job). */
export async function completeJob(contratacionId: string): Promise<void> {
  await trabajadorFinalizarTrabajo(contratacionId);
}

export {
  aceptarPrecioCotizado,
  aplicarSeñaConCredito,
  trabajadorFinalizarTrabajo,
  fetchLatestContratacionServicioByConversation,
} from './contratacionesSupabase';
