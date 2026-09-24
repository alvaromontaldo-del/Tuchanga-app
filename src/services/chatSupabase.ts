import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';
import { removeSupabaseRealtimeTopic, removeSupabaseRealtimeTopicAsync } from '../lib/supabaseRealtime';
import { fetchClosedClaimChatIds } from './claimChatSupabase';
import { CHAT_CERRADO_POR_RECLAMO } from '../utils/claimChatVisibility';
import { mapChatSendError } from '../utils/chatErrors';
import type { ApiConversation, ApiMessage, ConversationRole } from './chatApi';
import type { InboxRealtimeEvent } from './inboxState';

function firstNameOnly(name: string): string {
  const s = (name ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return 'Usuario';
  const parts = s.split(' ').filter(Boolean);
  return parts[0] ?? 'Usuario';
}

/**
 * Inbox 1:1 por peer: conservar SOLO la conversación más reciente por otherUserId.
 * Clave = otherUserId (no myRole): evita vieja+nueva aunque el rol se lea mal.
 */
export function dedupeInboxByPeer(rows: ApiConversation[]): ApiConversation[] {
  const best = new Map<string, ApiConversation>();
  for (const row of rows) {
    const key = row.otherUserId || row.id;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    const prevTs = new Date(prev.lastMessageAt ?? prev.updatedAt).getTime();
    const nextTs = new Date(row.lastMessageAt ?? row.updatedAt).getTime();
    if (nextTs >= prevTs) best.set(key, row);
  }
  return Array.from(best.values());
}

/** Soft-delete + hide ambos (fallback si la RPC falla o quedó a medias). */
async function forceSoftDeleteConversation(
  sb: ReturnType<typeof getSupabaseClient>,
  conversationId: string,
): Promise<void> {
  const { error: rpcErr } = await sb.rpc('hide_conversation', {
    p_conversation_id: conversationId,
  });
  if (!rpcErr) {
    const { data: after } = await sb
      .from('conversations')
      .select('deleted_at')
      .eq('id', conversationId)
      .maybeSingle();
    if (after && (after as { deleted_at?: string | null }).deleted_at) return;
  }

  const ts = new Date().toISOString();
  const { data: conv } = await sb
    .from('conversations')
    .select('id,cliente_id,trabajador_id,deleted_at')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return;

  const row = conv as {
    id: string;
    cliente_id: string;
    trabajador_id: string;
    deleted_at?: string | null;
  };

  await sb
    .from('conversations')
    .update({ deleted_at: row.deleted_at ?? ts, updated_at: ts })
    .eq('id', conversationId);

  const hides = [
    { conversation_id: conversationId, user_id: row.cliente_id, hidden_at: ts },
    { conversation_id: conversationId, user_id: row.trabajador_id, hidden_at: ts },
  ];
  await sb.from('conversation_hides').upsert(hides, { onConflict: 'conversation_id,user_id' });
}

/** Cierra TODOS los hilos activos del mismo par excepto `keepId` (si se pasa). */
async function softDeleteSiblingConversations(
  sb: ReturnType<typeof getSupabaseClient>,
  clienteId: string,
  trabajadorId: string,
  keepId?: string | null,
): Promise<void> {
  const { data: siblings } = await sb
    .from('conversations')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('trabajador_id', trabajadorId)
    .is('deleted_at', null);
  for (const s of (siblings ?? []) as Array<{ id: string }>) {
    if (!s?.id || (keepId && s.id === keepId)) continue;
    await forceSoftDeleteConversation(sb, s.id);
  }
}

export async function fetchConversationsSupabase(): Promise<ApiConversation[]> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const { data: convs, error } = await sb
    .from('conversations')
    .select('id,cliente_id,trabajador_id,primary_trade,updated_at,deleted_at')
    .or(`cliente_id.eq.${user.id},trabajador_id.eq.${user.id}`)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (error || !convs?.length) return [];

  // Defensa: nunca listar soft-deleted aunque el filtro PostgREST falle / schema cache viejo.
  const activeConvs = (convs as Array<{
    id: string;
    cliente_id: string;
    trabajador_id: string;
    primary_trade?: string | null;
    updated_at?: string | null;
    deleted_at?: string | null;
  }>).filter((c) => !c.deleted_at);

  if (!activeConvs.length) return [];

  const closedClaimIds = await fetchClosedClaimChatIds(activeConvs.map((c) => c.id));

  const results: ApiConversation[] = [];

  // Conteo exacto de no leídos (1 RPC para todas las conversaciones)
  const convIds = activeConvs.map((c) => c.id);
  const unreadById = new Map<string, number>();
  try {
    const { data: unreadRows } = await sb.rpc('get_unread_counts', {
      p_conversation_ids: convIds,
    });
    const rows = (unreadRows ?? []) as Array<{ conversation_id: string; unread_count: number }>;
    for (const r of rows) unreadById.set(r.conversation_id, Number(r.unread_count) || 0);
  } catch {
    // Si la RPC no existe todavía, omitimos (badge cae a 0; el no-leído “booleano” sigue por reads locales).
  }

  // peerReadAt por conversación (para ticks en lista)
  const peerReadById = new Map<string, string>();
  try {
    const { data: peerRows } = await sb.rpc('get_peer_read_ats', {
      p_conversation_ids: convIds,
    });
    const rows = (peerRows ?? []) as Array<{ conversation_id: string; peer_read_at: string }>;
    for (const r of rows) {
      if (r?.conversation_id && r?.peer_read_at) peerReadById.set(r.conversation_id, r.peer_read_at);
    }
  } catch {
    // Si la RPC no existe aún, dejamos null (igual se ven ✓/✓✓ en el detalle).
  }

  // Soft-delete / ocultos definitivos: nunca reaparecen (aunque haya mensajes viejos).
  const hiddenIds = new Set<string>();
  try {
    const { data: hideRows, error: he } = await sb
      .from('conversation_hides')
      .select('conversation_id')
      .eq('user_id', user.id)
      .in('conversation_id', convIds);
    if (!he) {
      const rows = (hideRows ?? []) as Array<{ conversation_id: string }>;
      for (const r of rows) {
        if (r?.conversation_id) hiddenIds.add(r.conversation_id);
      }
    }
  } catch {
    // si la tabla aún no existe, ignoramos
  }

  for (const c of activeConvs) {
    if (hiddenIds.has(c.id)) continue;

    const myRole: ConversationRole = c.cliente_id === user.id ? 'cliente' : 'trabajador';
    const otherId = myRole === 'cliente' ? c.trabajador_id : c.cliente_id;
    const { data: prof } = await sb
      .from('profiles')
      .select('nombre,apellido,avatar_url')
      .eq('id', otherId)
      .maybeSingle();
    const full = prof ? `${prof.nombre ?? ''} ${prof.apellido ?? ''}`.trim() : 'Usuario';
    const name = firstNameOnly(full);

    const { data: lastMsgs } = await sb
      .from('messages')
      .select('body,type,created_at,sender_id')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const last = lastMsgs?.[0] as
      | { body?: string | null; type?: string | null; created_at?: string; sender_id?: string }
      | undefined;

    let primaryTrade = c.primary_trade ?? '';
    if (!primaryTrade) {
      const { data: job } = await sb
        .from('jobs')
        .select('nombre_oficio')
        .eq('user_id', otherId)
        .eq('es_principal', true)
        .maybeSingle();
      primaryTrade = job?.nombre_oficio ?? '';
    }

    const closedByClaim = closedClaimIds.has(c.id);
    results.push({
      id: c.id,
      otherUserId: otherId,
      otherDisplayName: name,
      otherAvatarUrl: (prof as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      primaryTrade,
      lastMessage: closedByClaim
        ? CHAT_CERRADO_POR_RECLAMO
        : last?.type === 'image'
          ? '📷 Foto'
          : last?.body ?? null,
      lastMessageAt: last?.created_at ?? null,
      lastMessageSenderId: last?.sender_id ?? null,
      peerReadAt: peerReadById.get(c.id) ?? null,
      unreadCount: closedByClaim ? 0 : (unreadById.get(c.id) ?? 0),
      updatedAt: c.updated_at ?? new Date().toISOString(),
      myRole,
    });
  }

  // Defensa client-side: 1 fila por peer (evita vieja+nueva si el backfill aún no corrió).
  return dedupeInboxByPeer(results);
}

export async function fetchMessagesSupabase(conversationId: string): Promise<ApiMessage[]> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return [];

  const { data: conv } = await sb
    .from('conversations')
    .select('id,deleted_at')
    .eq('id', conversationId)
    .or(`cliente_id.eq.${user.id},trabajador_id.eq.${user.id}`)
    .maybeSingle();
  if (!conv || (conv as { deleted_at?: string | null }).deleted_at) return [];

  const { data: hideRow } = await sb
    .from('conversation_hides')
    .select('conversation_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (hideRow) return [];

  const { data, error } = await sb
    .from('messages')
    .select('id,conversation_id,sender_id,body,type,metadata,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    text: row.body,
    status: 'sent',
    created_at: row.created_at,
    type: (row as { type?: ApiMessage['type'] }).type ?? 'text',
    metadata: (row as { metadata?: Record<string, unknown> }).metadata ?? {},
  }));
}

export async function fetchTotalUnreadCountSupabase(): Promise<number> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('get_total_unread_count');
  if (error) throw error;
  return Math.max(0, Number(data) || 0);
}

export async function deleteConversationSupabase(conversationId: string): Promise<void> {
  const sb = getSupabaseClient();

  // Soft-delete vía RPC (deleted_at + hide ambos). Si falla o queda a medias, forzar.
  const { error } = await sb.rpc('hide_conversation', { p_conversation_id: conversationId });
  if (error) {
    await forceSoftDeleteConversation(sb, conversationId);
    return;
  }

  const { data: after } = await sb
    .from('conversations')
    .select('id,deleted_at')
    .eq('id', conversationId)
    .maybeSingle();
  if (after && !(after as { deleted_at?: string | null }).deleted_at) {
    await forceSoftDeleteConversation(sb, conversationId);
  }
}

export async function sendMessageSupabase(
  conversationId: string,
  text: string,
  type: NonNullable<ApiMessage['type']> = 'text',
  metadata: Record<string, unknown> = {},
): Promise<ApiMessage> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error('No autenticado');

  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: text,
      type,
      metadata,
    })
    .select('id,conversation_id,sender_id,body,type,metadata,created_at')
    .single();

  if (error || !data) {
    throw new Error(mapChatSendError(error));
  }

  return {
    id: data.id,
    conversation_id: data.conversation_id,
    sender_id: data.sender_id,
    text: data.body,
    status: 'sent',
    created_at: data.created_at,
    type: (data as { type?: ApiMessage['type'] }).type ?? type,
    metadata: ((data as { metadata?: Record<string, unknown> }).metadata ?? metadata) as Record<
      string,
      unknown
    >,
  };
}

export async function findOrCreateConversationSupabase(
  workerUserId: string,
  primaryTrade: string,
): Promise<{ conversationId: string; workerDisplayName: string; primaryTrade: string }> {
  const sb = getSupabaseClient();
  const {
    data: { user },
    error: ue,
  } = await sb.auth.getUser();
  if (ue || !user?.id) {
    throw new Error('No hay sesión activa.');
  }

  const { data, error } = await sb.rpc('find_or_create_conversation', {
    p_trabajador_id: workerUserId,
    p_primary_trade: primaryTrade,
  });

  if (error) throw error;
  const convId = data as string;

  // Defensa client-side: soft-delete cualquier otro hilo activo del mismo par.
  try {
    await softDeleteSiblingConversations(sb, user.id, workerUserId, convId);
  } catch {
    /* no bloquear apertura del chat */
  }

  const { data: prof } = await sb
    .from('profiles')
    .select('nombre,apellido')
    .eq('id', workerUserId)
    .maybeSingle();
  const full = prof ? `${prof.nombre ?? ''} ${prof.apellido ?? ''}`.trim() : 'Profesional';
  const workerDisplayName = firstNameOnly(full);

  return {
    conversationId: convId,
    workerDisplayName,
    primaryTrade,
  };
}

export function subscribeToConversationMessages(
  conversationId: string,
  onInsert: (msg: ApiMessage) => void,
  onUpdate?: (msg: ApiMessage) => void,
): () => void {
  const sb = getSupabaseClient();
  const channelName = `messages:${conversationId}`;
  removeSupabaseRealtimeTopic(sb, channelName);
  const channel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = payload.new as {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          type?: ApiMessage['type'];
          metadata?: Record<string, unknown>;
          created_at: string;
        };
        onInsert({
          id: row.id,
          conversation_id: row.conversation_id,
          sender_id: row.sender_id,
          text: row.body,
          status: 'sent',
          created_at: row.created_at,
          type: row.type ?? 'text',
          metadata: row.metadata ?? {},
        });
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        if (!onUpdate) return;
        const row = payload.new as {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          type?: ApiMessage['type'];
          metadata?: Record<string, unknown>;
          created_at: string;
        };
        onUpdate({
          id: row.id,
          conversation_id: row.conversation_id,
          sender_id: row.sender_id,
          text: row.body,
          status: 'sent',
          created_at: row.created_at,
          type: row.type ?? 'text',
          metadata: row.metadata ?? {},
        });
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

type RealtimeChannel = ReturnType<SupabaseClient['channel']>;

/**
 * Inbox Realtime con reconexión. INSERT mensajes + lecturas propias.
 */
export function subscribeToUserInboxEvents(
  userId: string,
  onEvent: (event: InboxRealtimeEvent) => void,
): () => void {
  const sb = getSupabaseClient();
  const channelName = `inbox:${userId}`;
  let cancelled = false;
  let channel: RealtimeChannel | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (cancelled) return;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void attach();
    }, 1200);
  };

  const attach = async () => {
    clearReconnectTimer();
    await removeSupabaseRealtimeTopicAsync(sb, channelName);
    if (cancelled) return;

    channel = sb
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `cliente_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string };
          if (!row?.id) return;
          onEvent({ type: 'conversation_activity', conversationId: row.id });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `trabajador_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string };
          if (!row?.id) return;
          onEvent({ type: 'conversation_activity', conversationId: row.id });
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as {
            id?: string;
            conversation_id?: string;
            sender_id?: string;
            body?: string;
            created_at?: string;
          };
          if (!row?.conversation_id || !row.sender_id || !row.created_at) return;
          onEvent({
            type: 'message',
            conversationId: row.conversation_id,
            senderId: row.sender_id,
            body: String(row.body ?? ''),
            createdAt: row.created_at,
            messageId: row.id,
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_reads',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            conversation_id?: string;
            user_id?: string;
            read_at?: string;
          };
          if (!row?.conversation_id || !row.read_at) return;
          onEvent({
            type: 'read',
            conversationId: row.conversation_id,
            userId: row.user_id ?? userId,
            readAt: row.read_at,
          });
        },
      );

    channel.subscribe((status) => {
      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        scheduleReconnect();
      }
    });
  };

  void attach();

  return () => {
    cancelled = true;
    clearReconnectTimer();
    if (channel) void sb.removeChannel(channel);
    channel = null;
  };
}
