/**
 * Decisión de chat del reclamo de garantía.
 * La función SQL `iniciar_reclamo_garantia` sigue estas mismas reglas.
 */

export type PairJob = {
  id: string;
  estadoTrabajo: string;
  isClaimOpen: boolean;
  claimStatus: string | null;
};

export type ClaimChatDecision = {
  kind: 'use' | 'create';
  conversationId: string | null;
  closeConversationId: string | null;
  nameJobInEvent: boolean;
};

export const WARRANTY_CLAIM_EVENT_GENERIC =
  'El cliente inició un reclamo de garantía. Coordinen la revisión por este chat. La garantía sigue su curso.';

/** Reclamo abierto o pendiente: no se puede ocultar el chat de ese trabajo. */
export function claimChatHasOpenClaim(job: {
  isClaimOpen: boolean;
  claimStatus: string | null;
}): boolean {
  return (
    job.isClaimOpen ||
    job.claimStatus === 'open' ||
    job.claimStatus === 'pending_approval'
  );
}

/**
 * Solo se cierra el otro chat si tiene al menos un trabajo y todos están
 * finalizados, sin reclamo abierto ni pendiente.
 */
export function otherChatCanBeClosed(jobs: PairJob[], contratacionId: string): boolean {
  const others = jobs.filter((job) => job.id !== contratacionId);
  if (others.length === 0) return false;
  return others.every(
    (job) => job.estadoTrabajo === 'finalizado' && !claimChatHasOpenClaim(job),
  );
}

export function resolveWarrantyClaimChat(params: {
  own: { id: string; active: boolean } | null;
  activePair: { id: string; jobs: PairJob[] } | null;
  contratacionId: string;
}): ClaimChatDecision {
  if (params.own?.active) {
    return {
      kind: 'use',
      conversationId: params.own.id,
      closeConversationId: null,
      nameJobInEvent: false,
    };
  }

  const active = params.activePair;
  if (active && !otherChatCanBeClosed(active.jobs, params.contratacionId)) {
    return {
      kind: 'use',
      conversationId: active.id,
      closeConversationId: null,
      nameJobInEvent: true,
    };
  }

  return {
    kind: 'create',
    conversationId: null,
    closeConversationId: active ? active.id : null,
    nameJobInEvent: false,
  };
}

/** Fecha del trabajo para el aviso cuando el evento cae en el chat de otro trabajo. */
export function warrantyClaimEventFecha(params: {
  fechaTrabajo?: string | null;
  finalizadoAt?: string | null;
  createdAt?: string | null;
}): string {
  const trabajo = (params.fechaTrabajo ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trabajo)) {
    const [year, month, day] = trabajo.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  }
  const iso = params.finalizadoAt || params.createdAt;
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

export function warrantyClaimEventBody(params: {
  nameJob: boolean;
  serviceDetail?: string | null;
  fecha?: string | null;
}): string {
  if (!params.nameJob) return WARRANTY_CLAIM_EVENT_GENERIC;
  const servicio = (params.serviceDetail ?? '').trim();
  const fecha = (params.fecha ?? '').trim();
  if (servicio && fecha) {
    return `El cliente inició un reclamo de garantía por «${servicio}» del ${fecha}. Coordinen la revisión por este chat. La garantía sigue su curso.`;
  }
  if (servicio) {
    return `El cliente inició un reclamo de garantía por «${servicio}». Coordinen la revisión por este chat. La garantía sigue su curso.`;
  }
  if (fecha) {
    return `El cliente inició un reclamo de garantía del ${fecha}. Coordinen la revisión por este chat. La garantía sigue su curso.`;
  }
  return WARRANTY_CLAIM_EVENT_GENERIC;
}
