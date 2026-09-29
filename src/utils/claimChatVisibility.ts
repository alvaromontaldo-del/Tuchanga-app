/**
 * Visibilidad del chat cuando un hilo tiene una o varias contrataciones.
 *
 * Misma regla que chat_cerrado_por_reclamo_conformidad: el chat sale de
 * Mensajes solo si tuvo al menos un reclamo, todos los reclamos iniciados
 * terminaron con conformidad de las dos partes, y ninguna contratación
 * vinculada está en curso ni tiene reclamo abierto o pendiente.
 * Un trabajo finalizado que nunca tuvo reclamo no alcanza para ocultarlo.
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
 * true cuando hay contrataciones y ninguna está en curso ni con reclamo
 * abierto o pendiente. No es la regla de ocultado de Mensajes.
 */
export function allLinkedJobsClosedWithoutOpenClaim(rows: ClaimChatSnapshot[]): boolean {
  if (!rows.length) return false;
  return rows.every((row) => !jobKeepsChatOpen(row));
}

/**
 * Ocultado de #55. Igual que el SQL: al menos una conformidad completa,
 * ningún reclamo iniciado a medias, y ninguna contratación en curso o con
 * reclamo abierto o pendiente.
 */
export function chatClosedByAllClaimsConformity(rows: ClaimChatSnapshot[]): boolean {
  if (!rows.length) return false;
  const hasFullConformity = rows.some((row) => isChatClosedByClaimConformity(row));
  const hasIncompleteClaim = rows.some(
    (row) => Boolean(row.claim_opened_at) && !isChatClosedByClaimConformity(row),
  );
  const hasLiveJob = rows.some((row) => jobKeepsChatOpen(row));
  return hasFullConformity && !hasIncompleteClaim && !hasLiveJob;
}
