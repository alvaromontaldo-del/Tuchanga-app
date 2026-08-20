import { CONTACT_MODERATION_POLICY_MESSAGE } from './contactModeration';

/** Errores de Supabase al insertar/actualizar texto moderado. */
export function mapContentModerationError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const m = raw.toLowerCase();

  if (
    m.includes('message_blocked_contact') ||
    m.includes('content_blocked_contact') ||
    m.includes('contact_info_blocked')
  ) {
    return CONTACT_MODERATION_POLICY_MESSAGE;
  }

  return raw || 'No se pudo guardar el contenido.';
}
