/**
 * Acciones del chat mientras hay un reclamo de garantía (#119).
 *
 * El reclamo es de una contratación (`is_claim_open` / `claim_status`), no del par.
 * Si ese trabajo comparte hilo con otro, `iniciar_reclamo_garantia` abre un chat
 * propio (`conversations.contratacion_id`) y deja el otro trabajo en el hilo general.
 * Por eso el bloqueo mira los trabajos de ESTE hilo, no todos los del par.
 *
 * Con el reclamo abierto, las acciones propias de ese trabajo quedan en Agenda
 * (la revisita que ya acepta `proponer_disponibilidad_opciones`). Materiales y una
 * cotización nueva de ese trabajo se ocultan. Otro trabajo vivo del mismo hilo
 * conserva las suyas. Al cerrar el reclamo (`claim_status` cerrado y
 * `is_claim_open` falso) vuelven las acciones de siempre.
 *
 * `rechazar_disponibilidad` sigue exigiendo `precio_aceptado`. En la revisita el
 * cliente confirma (`aceptar_disponibilidad_opcion` ya tiene la rama de garantía)
 * y el profesional reenvía opciones. No se cambia esa RPC.
 */

export type ClaimChatJob = {
  id: string;
  estadoTrabajo: string;
  isClaimOpen: boolean;
  claimStatus: string | null;
};

export const MATERIALS_CLAIM_BLOCKED_MESSAGE =
  'Este trabajo está en un reclamo de garantía. Coordiná la revisión con Agenda.';

const TERMINAL_JOB = new Set(['finalizado', 'cancelado', 'disputa']);

/** Reclamo en curso: abierto o esperando la conformidad del arreglo. */
export function jobHasOpenWarrantyClaim(job: {
  isClaimOpen?: boolean | null;
  claimStatus?: string | null;
}): boolean {
  return (
    job.isClaimOpen === true ||
    job.claimStatus === 'open' ||
    job.claimStatus === 'pending_approval'
  );
}

/**
 * La revisita de garantía. El SQL solo la acepta con el trabajo finalizado
 * y el reclamo abierto o pendiente.
 */
export function jobUsesWarrantyRevisitAgenda(job: {
  estadoTrabajo?: string | null;
  isClaimOpen?: boolean | null;
  claimStatus?: string | null;
}): boolean {
  return job.estadoTrabajo === 'finalizado' && jobHasOpenWarrantyClaim(job);
}

/** Otro trabajo del mismo hilo que todavía puede cotizar o pedir materiales. */
export function jobKeepsQuoteAndMaterials(job: ClaimChatJob): boolean {
  if (jobHasOpenWarrantyClaim(job)) return false;
  return !TERMINAL_JOB.has(job.estadoTrabajo);
}

export type ClaimChatActionDecision = {
  /** El trabajo que el chat está mostrando tiene el reclamo abierto. */
  focusClaimOpen: boolean;
  /** En este hilo hay otro trabajo, sin reclamo, que sigue en curso o cotizando. */
  otherLiveJobKeepsActions: boolean;
  /** Ocultar Materiales y una cotización nueva del trabajo reclamado. */
  blockOwnQuoteAndMaterials: boolean;
  /** Mostrar Agenda para coordinar la revisión de ese trabajo. */
  showAgenda: boolean;
};

export function claimChatActions(input: {
  focusJobId: string | null;
  jobs: ClaimChatJob[];
}): ClaimChatActionDecision {
  const focus = input.focusJobId
    ? input.jobs.find((job) => job.id === input.focusJobId) ?? null
    : null;
  const focusClaimOpen = Boolean(focus && jobHasOpenWarrantyClaim(focus));
  const otherLiveJobKeepsActions = input.jobs.some(
    (job) => job.id !== focus?.id && jobKeepsQuoteAndMaterials(job),
  );
  return {
    focusClaimOpen,
    otherLiveJobKeepsActions,
    blockOwnQuoteAndMaterials: focusClaimOpen && !otherLiveJobKeepsActions,
    showAgenda: Boolean(focus && jobUsesWarrantyRevisitAgenda(focus)),
  };
}

/**
 * Alta de materiales de este hilo. Se rechaza solo si hay un reclamo abierto
 * y ningún otro trabajo del mismo hilo sigue pudiendo pedirlos.
 */
export function conversationBlocksNewMaterials(jobs: ClaimChatJob[]): boolean {
  if (!jobs.some((job) => jobHasOpenWarrantyClaim(job))) return false;
  return !jobs.some((job) => jobKeepsQuoteAndMaterials(job));
}
