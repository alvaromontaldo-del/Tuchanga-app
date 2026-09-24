import { mapContentModerationError } from './contentModerationErrors';

/** Texto legible desde Error, PostgrestError u objetos de Supabase (evita "[object Object]"). */
export function extractErrorMessage(e: unknown): string {
  if (typeof e === 'string') return e.trim();
  if (e instanceof Error) {
    const msg = e.message?.trim();
    if (msg && msg !== '[object Object]') return msg;
  }
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    if (typeof o.error_description === 'string' && o.error_description.trim()) {
      return o.error_description.trim();
    }
    if (typeof o.details === 'string' && o.details.trim()) return o.details.trim();
  }
  return 'No se pudo enviar el mensaje.';
}

/** Mensajes amigables para errores de Supabase en chat. */
export function mapChatSendError(e: unknown): string {
  const raw = extractErrorMessage(e);
  const m = raw.toLowerCase();

  if (
    m.includes('message_blocked_contact') ||
    m.includes('content_blocked_contact')
  ) {
    return mapContentModerationError(e);
  }
  if (m.includes('rate_limit_exceeded')) {
    return 'Enviaste demasiados mensajes seguidos. Esperá un momento e intentá de nuevo.';
  }
  if (m.includes('chat_cerrado_por_reclamo')) {
    return 'Chat cerrado por reclamo. El reclamo ya se inició y las dos partes dieron conformidad.';
  }
  if (m.includes('user_blocked')) {
    return 'No podés responder a esta conversación (bloqueo activo).';
  }
  if (m.includes('image_client_only')) {
    return 'Solo el cliente puede enviar imágenes en este chat.';
  }
  if (m.includes('image_url_required')) {
    return 'La imagen no se pudo adjuntar. Intentá de nuevo.';
  }
  if (m.includes('message_too_long')) {
    return 'El mensaje es demasiado largo (máximo 2000 caracteres).';
  }
  if (m.includes('not_authenticated') || m.includes('jwt')) {
    return 'Tu sesión expiró. Volvé a ingresar.';
  }

  return raw || 'No se pudo enviar el mensaje.';
}
