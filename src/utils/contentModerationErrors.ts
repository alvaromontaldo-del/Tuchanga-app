/** Errores de Supabase al guardar texto libre. Ya no traduce rechazos anti-contacto. */
export function mapContentModerationError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const m = raw.toLowerCase();

  if (
    m.includes('message_blocked_contact') ||
    m.includes('content_blocked_contact') ||
    m.includes('contact_info_blocked')
  ) {
    return 'No se pudo guardar el contenido.';
  }

  return raw || 'No se pudo guardar el contenido.';
}
