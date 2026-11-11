/**
 * Acciones del chat mientras hay un reclamo de garantía (#119).
 *
 * El reclamo es de una contratación (`is_claim_open` / `claim_status`), no del par.
 * Si ese trabajo comparte hilo con otro, `iniciar_reclamo_garantia` abre un chat
 * propio (`conversations.contratacion_id`) y deja el otro trabajo en el hilo general.
 * Por eso el bloqueo mira los trabajos de ESTE hilo, no todos los del par.
 *
 * Con el reclamo abierto, Cotizar, recotizar y editar presupuesto de ese trabajo
 * quedan deshabilitados. Materiales sigue igual que en un chat normal: el botón
 * se ve y el alta no se rechaza. Otro trabajo vivo del mismo hilo conserva
 * Cotizar. Agenda de la revisita no cambia. Al cerrar el reclamo (`claim_status`
 * cerrado e `is_claim_open` falso) vuelve a habilitarse la cotización.
 *
 * La revisita confirmada no es la fecha del trabajo original. Hace falta una
 * opción aceptada desde que se abrió el reclamo, igual a la fecha y hora que
 * la contratación tiene ahora. Volver a proponer borra esa fecha y es explícito.
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

/** Otro trabajo del mismo hilo que todavía puede cotizar. Materiales no miran el reclamo. */
export function jobKeepsQuoteAndMaterials(job: ClaimChatJob): boolean {
  if (jobHasOpenWarrantyClaim(job)) return false;
  return !TERMINAL_JOB.has(job.estadoTrabajo);
}

export type ClaimChatActionDecision = {
  /** El trabajo que el chat está mostrando tiene el reclamo abierto. */
  focusClaimOpen: boolean;
  /** En este hilo hay otro trabajo, sin reclamo, que sigue en curso o cotizando. */
  otherLiveJobKeepsActions: boolean;
  /** Deshabilitar Cotizar, recotizar y editar presupuesto del trabajo reclamado. */
  blockOwnQuote: boolean;
  /** Un reclamo de garantía no oculta ni rechaza Materiales. */
  blockOwnMaterials: boolean;
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
  const blockOwnQuote = focusClaimOpen && !otherLiveJobKeepsActions;
  return {
    focusClaimOpen,
    otherLiveJobKeepsActions,
    blockOwnQuote,
    blockOwnMaterials: false,
    showAgenda: Boolean(focus && jobUsesWarrantyRevisitAgenda(focus)),
  };
}

/**
 * Alta de materiales de este hilo. El reclamo de garantía no la bloquea:
 * Materiales queda habilitado aunque Cotizar no.
 */
export function conversationBlocksNewMaterials(_jobs: ClaimChatJob[]): boolean {
  return false;
}

export type WarrantyRevisitOption = {
  id: string;
  estado: string;
  fechaTrabajo: string | null;
  horaInicio: string | null;
  horaFin: string | null;
  createdAt: string | null;
};

export type WarrantyRevisitSlot = {
  fecha: string;
  horaInicio: string;
  horaFin: string;
};

export type WarrantyRevisitPhase =
  | { phase: 'propuestas' }
  | { phase: 'confirmada'; slot: WarrantyRevisitSlot }
  | { phase: 'sin_horario' };

function dateKey(value: string | null | undefined): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec((value ?? '').trim());
  return match?.[1] ?? '';
}

function timeKey(value: string | null | undefined): string {
  const match = /^(\d{2}:\d{2})/.exec((value ?? '').trim());
  return match?.[1] ?? '';
}

/** Texto único del horario ya aceptado. No incluye la fecha del trabajo original. */
export function formatWarrantyRevisitConfirmed(slot: WarrantyRevisitSlot): string {
  const [year, month, day] = slot.fecha.split('-');
  return `Revisión confirmada: ${day}/${month}/${year} · ${slot.horaInicio} – ${slot.horaFin}`;
}

/**
 * Estado de la revisita en el chat y en el detalle.
 * `confirmada` solo si la contratación conserva fecha y hora iguales a una
 * opción aceptada posterior a `claim_opened_at`. Una fecha anterior, o una
 * opción aceptada cuya hora ya se borró al reenviar, no cuentan.
 * Con propuestas abiertas se elige entre esas, aunque quede una aceptación vieja.
 */
export function warrantyRevisitPhase(input: {
  estadoTrabajo?: string | null;
  isClaimOpen?: boolean | null;
  claimStatus?: string | null;
  claimOpenedAt?: string | null;
  fechaTrabajo?: string | null;
  horaInicio?: string | null;
  horaFin?: string | null;
  opciones: WarrantyRevisitOption[];
}): WarrantyRevisitPhase {
  if (!jobUsesWarrantyRevisitAgenda(input)) return { phase: 'sin_horario' };
  if (input.opciones.some((option) => option.estado === 'propuesta')) {
    return { phase: 'propuestas' };
  }

  const openedAt = Date.parse(input.claimOpenedAt ?? '');
  const fecha = dateKey(input.fechaTrabajo);
  const horaInicio = timeKey(input.horaInicio);
  const horaFin = timeKey(input.horaFin);
  if (!Number.isFinite(openedAt) || !fecha || !horaInicio || !horaFin) {
    return { phase: 'sin_horario' };
  }

  const match = input.opciones
    .filter((option) => option.estado === 'aceptada')
    .filter((option) => {
      const createdAt = Date.parse(option.createdAt ?? '');
      return Number.isFinite(createdAt) && createdAt >= openedAt;
    })
    .filter(
      (option) =>
        dateKey(option.fechaTrabajo) === fecha &&
        timeKey(option.horaInicio) === horaInicio &&
        timeKey(option.horaFin) === horaFin,
    )
    .sort(
      (a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''),
    )[0];

  if (!match) return { phase: 'sin_horario' };
  return { phase: 'confirmada', slot: { fecha, horaInicio, horaFin } };
}
