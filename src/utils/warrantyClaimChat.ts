/**
 * Decisión de chat del reclamo de garantía.
 * La función SQL `iniciar_reclamo_garantia` sigue estas mismas reglas.
 *
 * Un reclamo que comparte hilo con otro trabajo abre un chat propio
 * (`conversations.contratacion_id`). No se cierra el chat de un trabajo
 * en curso ni el de un reclamo abierto o pendiente.
 */

export type PairJob = {
  id: string;
  estadoTrabajo: string;
  isClaimOpen: boolean;
  claimStatus: string | null;
};

export type OwnClaimChat = {
  id: string;
  active: boolean;
  /** Otra contratación sigue apuntando a este hilo. */
  shared: boolean;
  /** `conversations.contratacion_id` ya es esta contratación. */
  markedForThisJob: boolean;
  /** El hilo ya tiene un aviso de reclamo de otra contratación. */
  foreignClaimMessages: boolean;
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

function ownChatIsReusable(own: OwnClaimChat): boolean {
  if (!own.active) return false;
  if (own.markedForThisJob) return true;
  return !own.shared && !own.foreignClaimMessages;
}

export function resolveWarrantyClaimChat(params: {
  own: OwnClaimChat | null;
  activePair: { id: string; jobs: PairJob[] } | null;
  contratacionId: string;
}): ClaimChatDecision {
  if (params.own && ownChatIsReusable(params.own)) {
    return {
      kind: 'use',
      conversationId: params.own.id,
      closeConversationId: null,
      nameJobInEvent: false,
    };
  }

  const active = params.activePair;
  const closeConversationId =
    active &&
    active.id !== params.own?.id &&
    otherChatCanBeClosed(active.jobs, params.contratacionId)
      ? active.id
      : null;

  return {
    kind: 'create',
    conversationId: null,
    closeConversationId,
    nameJobInEvent: true,
  };
}

/** Identidad de la fila en Mensajes. No usa el último mensaje. */
export function claimInboxRowLabel(params: {
  serviceDetail?: string | null;
  fecha?: string | null;
}): string {
  const servicio = (params.serviceDetail ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const fecha = (params.fecha ?? '').trim();
  if (servicio && fecha) return `Reclamo · ${servicio} · ${fecha}`;
  if (servicio) return `Reclamo · ${servicio}`;
  if (fecha) return `Reclamo · ${fecha}`;
  return 'Reclamo';
}

/** Fecha del trabajo para el aviso cuando el reclamo abre su propio hilo. */
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
