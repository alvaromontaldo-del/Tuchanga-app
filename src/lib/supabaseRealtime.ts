import type { SupabaseClient } from '@supabase/supabase-js';

/** Tópico interno (`realtime:nombre` o solo `nombre`). */
function normalizeRealtimeTopic(topic: string): string {
  return topic.startsWith('realtime:') ? topic : `realtime:${topic}`;
}

/**
 * Elimina un canal existente antes de volver a suscribirse.
 * Supabase reutiliza el mismo objeto si el tópico ya existe; añadir `.on()` tras `subscribe()` falla.
 */
export function removeSupabaseRealtimeTopic(sb: SupabaseClient, topic: string): void {
  void removeSupabaseRealtimeTopicAsync(sb, topic);
}

/** Espera a desmontar el canal antes de crear uno nuevo (evita suscripciones “fantasma”). */
export async function removeSupabaseRealtimeTopicAsync(
  sb: SupabaseClient,
  topic: string,
): Promise<void> {
  const fullTopic = normalizeRealtimeTopic(topic);
  const existing = sb.getChannels().find((c) => c.topic === fullTopic);
  if (existing) {
    await sb.removeChannel(existing);
  }
}
