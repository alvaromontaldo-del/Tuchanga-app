export type InboxPeerRow = {
  id: string;
  otherUserId?: string;
  lastMessageAt?: string | null;
  updatedAt?: string;
};

/**
 * Cada conversación es una fila. Tres reclamos con el mismo profesional
 * no se pisan: la clave es el id del hilo, no la persona.
 */
export function dedupeInboxByPeer<T extends InboxPeerRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const prev = best.get(row.id);
    if (!prev) {
      best.set(row.id, row);
      continue;
    }
    const prevTs = new Date(prev.lastMessageAt ?? prev.updatedAt ?? 0).getTime();
    const nextTs = new Date(row.lastMessageAt ?? row.updatedAt ?? 0).getTime();
    if (nextTs >= prevTs) best.set(row.id, row);
  }
  return Array.from(best.values());
}
