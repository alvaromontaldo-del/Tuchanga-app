import { describe, expect, it } from 'vitest';
import { dedupeInboxByPeer } from './inboxPeers';

describe('dedupeInboxByPeer', () => {
  it('mantiene tres reclamos del mismo profesional como chats distintos', () => {
    const rows = [
      { id: 'chat-a', otherUserId: 'worker-1', lastMessageAt: '2026-09-01T00:00:00.000Z' },
      { id: 'chat-b', otherUserId: 'worker-1', lastMessageAt: '2026-09-02T00:00:00.000Z' },
      { id: 'chat-c', otherUserId: 'worker-1', lastMessageAt: '2026-09-03T00:00:00.000Z' },
    ];
    expect(dedupeInboxByPeer(rows).map((row) => row.id)).toEqual(['chat-a', 'chat-b', 'chat-c']);
  });

  it('colapsa solo el mismo id repetido', () => {
    const rows = dedupeInboxByPeer([
      { id: 'chat-a', otherUserId: 'worker-1', lastMessageAt: '2026-09-01T00:00:00.000Z' },
      { id: 'chat-a', otherUserId: 'worker-1', lastMessageAt: '2026-09-04T00:00:00.000Z' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastMessageAt).toBe('2026-09-04T00:00:00.000Z');
  });
});
