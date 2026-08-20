import { getSupabaseClient } from '../lib/supabase';
import { fetchTotalUnreadCountSupabase } from './chatSupabase';

export type ConversationSnippet = {
  conversationId: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
};

/** Sync liviano (2–3 queries) para cuando Realtime no dispara. */
export async function fetchInboxSyncLight(): Promise<{
  totalUnread: number;
  unreadByConversationId: Record<string, number>;
  snippets: ConversationSnippet[];
}> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) {
    return { totalUnread: 0, unreadByConversationId: {}, snippets: [] };
  }

  const { data: convs, error: convErr } = await sb
    .from('conversations')
    .select('id,deleted_at')
    .or(`cliente_id.eq.${user.id},trabajador_id.eq.${user.id}`)
    .is('deleted_at', null);
  if (convErr || !convs?.length) {
    const totalUnread = await fetchTotalUnreadCountSupabase().catch(() => 0);
    return { totalUnread, unreadByConversationId: {}, snippets: [] };
  }

  const activeIds = (convs as Array<{ id: string; deleted_at?: string | null }>)
    .filter((c) => !c.deleted_at)
    .map((c) => c.id);

  // Excluir hides del usuario (legacy: hide sin deleted_at).
  const hiddenIds = new Set<string>();
  if (activeIds.length) {
    try {
      const { data: hideRows } = await sb
        .from('conversation_hides')
        .select('conversation_id')
        .eq('user_id', user.id)
        .in('conversation_id', activeIds);
      for (const r of (hideRows ?? []) as Array<{ conversation_id?: string }>) {
        if (r?.conversation_id) hiddenIds.add(r.conversation_id);
      }
    } catch {
      /* tabla opcional */
    }
  }

  const convIds = activeIds.filter((id) => !hiddenIds.has(id));
  if (!convIds.length) {
    const totalUnread = await fetchTotalUnreadCountSupabase().catch(() => 0);
    return { totalUnread, unreadByConversationId: {}, snippets: [] };
  }
  const unreadByConversationId: Record<string, number> = {};
  for (const id of convIds) unreadByConversationId[id] = 0;

  try {
    const { data: unreadRows } = await sb.rpc('get_unread_counts', {
      p_conversation_ids: convIds,
    });
    for (const r of (unreadRows ?? []) as Array<{
      conversation_id: string;
      unread_count: number;
    }>) {
      if (r?.conversation_id) {
        unreadByConversationId[r.conversation_id] = Math.max(0, Number(r.unread_count) || 0);
      }
    }
  } catch {
    /* RPC opcional */
  }

  let totalUnread = 0;
  try {
    totalUnread = await fetchTotalUnreadCountSupabase();
  } catch {
    totalUnread = Object.values(unreadByConversationId).reduce((n, v) => n + v, 0);
  }

  const snippets: ConversationSnippet[] = [];
  await Promise.all(
    convIds.map(async (conversationId) => {
      const { data: lastMsgs } = await sb
        .from('messages')
        .select('body,created_at,sender_id')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1);
      const last = lastMsgs?.[0];
      if (!last) return;
      snippets.push({
        conversationId,
        lastMessage: last.body ?? null,
        lastMessageAt: last.created_at ?? null,
        lastMessageSenderId: last.sender_id ?? null,
        unreadCount: unreadByConversationId[conversationId] ?? 0,
      });
    }),
  );

  return { totalUnread, unreadByConversationId, snippets };
}

export async function fetchConversationSnippet(
  conversationId: string,
): Promise<ConversationSnippet | null> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return null;

  const { data: conv } = await sb
    .from('conversations')
    .select('id,deleted_at')
    .eq('id', conversationId)
    .or(`cliente_id.eq.${user.id},trabajador_id.eq.${user.id}`)
    .maybeSingle();
  if (!conv || (conv as { deleted_at?: string | null }).deleted_at) return null;

  const { data: hideRow } = await sb
    .from('conversation_hides')
    .select('conversation_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (hideRow) return null;

  const { data: lastMsgs } = await sb
    .from('messages')
    .select('body,created_at,sender_id')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1);
  const last = lastMsgs?.[0];
  if (!last) return null;

  let unreadCount = 0;
  try {
    const { data: rows } = await sb.rpc('get_unread_counts', {
      p_conversation_ids: [conversationId],
    });
    const row = (rows as Array<{ conversation_id: string; unread_count: number }> | null)?.[0];
    if (row?.conversation_id === conversationId) {
      unreadCount = Math.max(0, Number(row.unread_count) || 0);
    }
  } catch {
    /* ignore */
  }

  return {
    conversationId,
    lastMessage: last.body ?? null,
    lastMessageAt: last.created_at ?? null,
    lastMessageSenderId: last.sender_id ?? null,
    unreadCount,
  };
}
