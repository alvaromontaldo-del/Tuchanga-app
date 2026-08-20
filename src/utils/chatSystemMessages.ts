import type { ChatSystemEvent } from '../types/contrataciones';

/**
 * Eventos que se muestran en la tarjeta fija inferior, no en el historial del chat.
 * Los de saldo (pagado/confirmado) sí van al scroll como trazabilidad del trabajo.
 */
const FIXED_BAR_SYSTEM_EVENTS = new Set<ChatSystemEvent>([
  'precio_aceptado_cliente',
  'precio_aceptado_trabajador',
  'disponibilidad_propuesta',
  'seña_pagada_cliente',
  'seña_pagada_trabajador',
  'conformidad_solicitada',
  'conformidad_aceptada',
  'conformidad_rechazada',
  'trabajo_finalizado',
]);

export function getSystemEvent(metadata?: Record<string, unknown>): ChatSystemEvent | null {
  const event = metadata?.event;
  if (typeof event !== 'string') return null;
  return event as ChatSystemEvent;
}

export function getSystemContratacionId(metadata?: Record<string, unknown>): string | null {
  const id = metadata?.contratacion_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Filtra mensajes system según el rol del usuario actual. */
export function shouldShowSystemMessage(
  metadata: Record<string, unknown> | undefined,
  myRole: 'cliente' | 'trabajador' | null,
): boolean {
  const event = getSystemEvent(metadata);
  if (event === 'conformidad_aceptada' && myRole === 'trabajador') return false;

  const audience = metadata?.audience;
  if (audience == null || audience === 'todos') return true;
  if (!myRole) return true;
  return audience === myRole;
}

/** Si false, el mensaje system no se renderiza en el scroll (va en tarjeta fija). */
export function shouldRenderSystemMessageInChat(
  metadata: Record<string, unknown> | undefined,
  myRole: 'cliente' | 'trabajador' | null,
): boolean {
  if (!shouldShowSystemMessage(metadata, myRole)) return false;
  const event = getSystemEvent(metadata);
  if (!event) return true;
  return !FIXED_BAR_SYSTEM_EVENTS.has(event);
}
