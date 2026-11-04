/**
 * Criterio para salir del chat cuando el servidor lo oculta al terminar
 * el trabajo. Espejo de hide_pair_chats_if_done y
 * conversation_tiene_trabajo_vivo: no se avisa si el hilo sigue visible
 * por otro trabajo o por un reclamo abierto.
 */

export const CONVERSATION_REMOVED_TITLE = 'Conversación eliminada';

export const CONVERSATION_REMOVED_MESSAGE =
  'La conversación fue eliminada porque el trabajo finalizó.';

export type ConversationJobSnapshot = {
  estado_trabajo?: string | null;
  estado_pago?: string | null;
  completed_by_worker_at?: string | null;
  conformidad_aceptada?: boolean | null;
  is_claim_open?: boolean | null;
  claim_status?: string | null;
  claim_opened_at?: string | null;
  claim_marked_done_at?: string | null;
  claim_resolved_at?: string | null;
};

const TERMINAL_JOB = new Set(['finalizado', 'cancelado', 'disputa']);

/** El trabajo o el reclamo todavía necesitan este hilo. */
export function jobKeepsConversationVisible(job: ConversationJobSnapshot): boolean {
  if (job.is_claim_open === true) return true;
  const claim = (job.claim_status ?? '').trim();
  if (claim === 'open' || claim === 'pending_approval') return true;
  return !TERMINAL_JOB.has((job.estado_trabajo ?? '').trim());
}

/**
 * El cierre que permite ocultar el chat: conformidad de las dos partes con
 * pago completo, o reclamo cerrado (el profesional marcó el arreglo y el
 * cliente dio conformidad, o corrieron las 72 h).
 */
export function jobClosesConversation(job: ConversationJobSnapshot): boolean {
  const claim = (job.claim_status ?? '').trim();
  const claimClosed =
    Boolean(job.claim_opened_at) &&
    Boolean(job.claim_marked_done_at) &&
    Boolean(job.claim_resolved_at) &&
    job.is_claim_open === false &&
    claim === 'closed';
  if (claimClosed) return true;
  return (
    (job.estado_trabajo ?? '').trim() === 'finalizado' &&
    Boolean(job.completed_by_worker_at) &&
    job.conformidad_aceptada === true &&
    (job.estado_pago ?? '').trim() === 'totalmente_pagado' &&
    job.is_claim_open !== true &&
    claim !== 'open' &&
    claim !== 'pending_approval'
  );
}

export type ConversationRemovalDecision = {
  /** deleted_at o hide de la conversación que el usuario está viendo. */
  removed: boolean;
  /** null = chat general del par. Un id = hilo de ese reclamo. */
  claimContratacionId?: string | null;
  /** Trabajos de este hilo (conversation_id o la contratación del reclamo). */
  linkedJobs: ConversationJobSnapshot[];
  /** Todos los trabajos del mismo cliente y profesional. */
  pairJobs: ConversationJobSnapshot[];
  alreadyAnnounced: boolean;
};

/**
 * true solo cuando hay que volver a la lista y mostrar el aviso, una vez.
 * Un trabajo vivo o un reclamo abierto del par deja el chat general en su lugar.
 * El hilo de un reclamo ya cerrado sí se abandona, aunque el par tenga otro trabajo.
 */
export function shouldLeaveDeletedConversation(input: ConversationRemovalDecision): boolean {
  if (input.alreadyAnnounced) return false;
  if (!input.removed) return false;
  if (input.linkedJobs.some(jobKeepsConversationVisible)) return false;
  const generalThread = !input.claimContratacionId;
  if (generalThread && input.pairJobs.some(jobKeepsConversationVisible)) return false;
  const closingPool = generalThread
    ? input.pairJobs.length > 0
      ? input.pairJobs
      : input.linkedJobs
    : input.linkedJobs;
  return closingPool.some(jobClosesConversation);
}
