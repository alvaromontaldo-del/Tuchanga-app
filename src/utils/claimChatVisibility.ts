/**
 * Cierre del chat tras reclamo de garantía con conformidad de las dos partes.
 *
 * Reclamo iniciado: `claim_opened_at`.
 * Conformidad del profesional: marcó el arreglo (`claim_marked_done_at`).
 * Conformidad del cliente: confirmó el arreglo, o el sistema lo aprobó a las 72 h
 * (`claim_resolved_at` + `claim_status = closed` + `is_claim_open = false`).
 *
 * Si la contratación más reciente del hilo no está en ese estado (por ejemplo
 * una cotización nueva), el chat sigue abierto.
 */

export const CHAT_CERRADO_POR_RECLAMO = 'Chat cerrado por reclamo';

export const CHAT_CERRADO_POR_RECLAMO_DETALLE =
  'El reclamo ya se inició y las dos partes dieron conformidad.';

export type ClaimChatSnapshot = {
  is_claim_open?: boolean | null;
  claim_status?: string | null;
  claim_opened_at?: string | null;
  claim_marked_done_at?: string | null;
  claim_resolved_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

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

/** true si la contratación más reciente del hilo cierra el chat. */
export function latestContratacionClosesChat(rows: ClaimChatSnapshot[]): boolean {
  if (!rows.length) return false;
  const latest = [...rows].sort((a, b) => {
    const byUpdated = timestamp(b.updated_at) - timestamp(a.updated_at);
    if (byUpdated !== 0) return byUpdated;
    return timestamp(b.created_at) - timestamp(a.created_at);
  })[0];
  return isChatClosedByClaimConformity(latest);
}
