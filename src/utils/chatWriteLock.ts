/**
 * Chat bloqueado para escribir cuando las dos conformidades ya están:
 * el profesional marcó el trabajo finalizado y el cliente dio conformidad,
 * y el cliente marcó el pago y el profesional lo recibió.
 *
 * No se bloquea si el par tiene otro trabajo vivo o un reclamo abierto (#84).
 * El hilo de un reclamo se bloquea cuando ese reclamo cierra (#206),
 * igual que el chat general. La reseña sigue habilitada; a los 7 días
 * sin reseña el servidor elimina el hilo.
 */

import {
  jobClosesConversation,
  type ConversationJobSnapshot,
} from './conversationRemovedNotice';

export const CHAT_LOCK_NOTICE_CLIENT =
  'Este chat está bloqueado. El trabajo y el pago ya quedaron confirmados. Podés dejar tu reseña. Si no la dejás, la conversación se elimina a los 7 días.';

export const CHAT_LOCK_NOTICE_WORKER =
  'Este chat está bloqueado. El trabajo y el pago ya quedaron confirmados. El cliente puede dejar una reseña. Si no la deja, la conversación se elimina a los 7 días.';

export const CHAT_LOCK_PLACEHOLDER = 'Chat bloqueado';

export type ChatLockJob = ConversationJobSnapshot & {
  id: string;
  conversationId: string | null;
};

function claimIsOpen(job: ConversationJobSnapshot): boolean {
  if (job.is_claim_open === true) return true;
  const claim = (job.claim_status ?? '').trim();
  return claim === 'open' || claim === 'pending_approval';
}

/** Igual que conversation_tiene_trabajo_vivo: disputa no mantiene el hilo. */
export function jobKeepsMaterialThreadLive(job: ConversationJobSnapshot): boolean {
  if (claimIsOpen(job)) return true;
  const estado = (job.estado_trabajo ?? '').trim();
  return estado !== 'finalizado' && estado !== 'cancelado' && estado !== 'disputa';
}

function jobSettledForLock(job: ConversationJobSnapshot): boolean {
  if ((job.estado_trabajo ?? '').trim() === 'cancelado') return true;
  return jobClosesConversation(job);
}

/**
 * Chat general del par. Hace falta al menos un cierre completo
 * (conformidad de las dos partes y pago, o reclamo cerrado) y que
 * ningún trabajo del par siga vivo o con reclamo abierto.
 */
export function generalChatShouldLock(jobs: ChatLockJob[]): boolean {
  if (jobs.length === 0) return false;
  if (!jobs.some(jobClosesConversation)) return false;
  if (jobs.some(claimIsOpen)) return false;
  return jobs.every(jobSettledForLock);
}

/** Hilo propio del reclamo: se bloquea al cerrarse ese reclamo. */
export function claimThreadShouldLock(input: {
  conversationId: string;
  claimContratacionId: string;
  jobs: ChatLockJob[];
}): boolean {
  const vivo = input.jobs.some(
    (job) => job.conversationId === input.conversationId && jobKeepsMaterialThreadLive(job),
  );
  if (vivo) return false;
  const claim = input.jobs.find((job) => job.id === input.claimContratacionId);
  if (!claim) return false;
  const status = (claim.claim_status ?? '').trim();
  return (
    Boolean(claim.claim_opened_at) &&
    Boolean(claim.claim_marked_done_at) &&
    Boolean(claim.claim_resolved_at) &&
    claim.is_claim_open === false &&
    status === 'closed'
  );
}

export function isChatWriteLocked(input: {
  jobsLoaded: boolean;
  conversationId: string;
  claimContratacionId: string | null;
  jobs: ChatLockJob[];
}): boolean {
  if (!input.jobsLoaded) return false;
  if (input.claimContratacionId) {
    return claimThreadShouldLock({
      conversationId: input.conversationId,
      claimContratacionId: input.claimContratacionId,
      jobs: input.jobs,
    });
  }
  return generalChatShouldLock(input.jobs);
}
