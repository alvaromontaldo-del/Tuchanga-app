/**
 * Visibilidad del chat cuando un hilo tiene una o varias contrataciones.
 *
 * El chat sale de Mensajes cuando todas están cerradas (finalizado, cancelado
 * o disputa) y ninguna tiene reclamo abierto o pendiente.
 *
 * El compositor se bloquea con «Chat cerrado por reclamo» solo si, además,
 * alguna de esas contrataciones llegó a la conformidad de las dos partes.
 * Un reclamo abierto o pendiente del mismo par mantiene el hilo usable.
 */

export const CHAT_CERRADO_POR_RECLAMO = 'Chat cerrado por reclamo';

export const CHAT_CERRADO_POR_RECLAMO_DETALLE =
  'El reclamo ya se inició y las dos partes dieron conformidad.';

const TERMINAL_JOB = new Set(['finalizado', 'cancelado', 'disputa']);

export type ClaimChatSnapshot = {
  is_claim_open?: boolean | null;
  claim_status?: string | null;
  claim_opened_at?: string | null;
  claim_marked_done_at?: string | null;
  claim_resolved_at?: string | null;
  estado_trabajo?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export function isChatClosedByClaimConformity(
  row: ClaimChatSnapshot | null | undefined,
): boolean {
  if (!row) return false;
  const started = Boolean(row.claim_opened_at);
  const workerConfirmed = Boolean(row.claim_marked_done_at);
  const clientConfirmed =
    row.is_claim_open === false &&
    row.claim_status === 'closed' &&
    Boolean(row.claim_resolved_at);
  return started && workerConfirmed && clientConfirmed;
}

/** El trabajo sigue necesitando el chat: no está cerrado, o el reclamo sigue vivo. */
export function jobKeepsChatOpen(row: ClaimChatSnapshot | null | undefined): boolean {
  if (!row) return true;
  if (row.is_claim_open === true) return true;
  if (row.claim_status === 'open' || row.claim_status === 'pending_approval') return true;
  return !TERMINAL_JOB.has(row.estado_trabajo ?? '');
}

/**
 * true cuando hay contrataciones y todas están cerradas sin reclamo abierto
 * ni pendiente. Un hilo sin contrataciones no se oculta por esta regla.
 */
export function allLinkedJobsClosedWithoutOpenClaim(rows: ClaimChatSnapshot[]): boolean {
  if (!rows.length) return false;
  return rows.every((row) => !jobKeepsChatOpen(row));
}

/**
 * Bloqueo por conformidad: todas las contrataciones del hilo están cerradas
 * sin reclamo abierto o pendiente, y al menos una llegó a conformidad.
 */
export function chatClosedByAllClaimsConformity(rows: ClaimChatSnapshot[]): boolean {
  if (!allLinkedJobsClosedWithoutOpenClaim(rows)) return false;
  return rows.some((row) => isChatClosedByClaimConformity(row));
}
