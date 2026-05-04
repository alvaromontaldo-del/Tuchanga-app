import { getSupabaseClient } from '../lib/supabase';
import type { ApiConversation, ApiMessage, ConversationRole } from './chatApi';

function firstNameOnly(name: string): string {
  const s = (name ?? '').trim();
  if (!s) return 'Usuario';
  const parts = s.split(/\s+/).filter(Boolean);
  return parts[0] ?? 'Usuario';
}

export async function fetchConversationsSupabase(): Promise<ApiConversation[]> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const { data: convs, error } = await sb
    .from('conversations')
    .select('id,cliente_id,trabajador_id,primary_trade,updated_at')
    .or(`cliente_id.eq.${user.id},trabajador_id.eq.${user.id}`)
    .order('updated_at', { ascending: false });

  if (error || !convs?.length) return [];

  const results: ApiConversation[] = [];

  // Conteo exacto de no leídos (1 RPC para todas las conversaciones)
  const convIds = convs.map((c) => c.id);
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

  // Ocultos por el usuario (se excluyen solo si no hubo mensajes nuevos desde hidden_at)
  const hiddenById = new Map<string, string>();
  try {
    const { data: hideRows, error: he } = await sb
      .from('conversation_hides')
      .select('conversation_id,hidden_at')
      .eq('user_id', user.id)
      .in('conversation_id', convIds);
    if (!he) {
      const rows = (hideRows ?? []) as Array<{ conversation_id: string; hidden_at: string }>;
      for (const r of rows) {
        if (r?.conversation_id && r?.hidden_at) hiddenById.set(r.conversation_id, r.hidden_at);
      }
    }
  } catch {
    // si la tabla aún no existe, ignoramos
  }

  for (const c of convs) {
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
      .select('body,created_at,sender_id')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const last = lastMsgs?.[0];

    const hiddenAt = hiddenById.get(c.id) ?? null;
    if (hiddenAt && last?.created_at) {
      // Si no hubo mensajes después de ocultar, no mostramos el hilo. Si hay mensajes nuevos, reaparece.
      if (new Date(last.created_at).getTime() <= new Date(hiddenAt).getTime()) {
        continue;
      }
    }

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

    results.push({
      id: c.id,
      otherUserId: otherId,
      otherDisplayName: name,
      otherAvatarUrl: (prof as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      primaryTrade,
      lastMessage: last?.body ?? null,
      lastMessageAt: last?.created_at ?? null,
      lastMessageSenderId: last?.sender_id ?? null,
      peerReadAt: peerReadById.get(c.id) ?? null,
      unreadCount: unreadById.get(c.id) ?? 0,
      updatedAt: c.updated_at ?? new Date().toISOString(),
      myRole,
    });
  }

  return results;
}

export async function fetchMessagesSupabase(conversationId: string): Promise<ApiMessage[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('messages')
    .select('id,conversation_id,sender_id,body,type,metadata,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    text: row.body,
    status: 'sent',
    created_at: row.created_at,
    type: (row as { type?: 'text' | 'budget' }).type ?? 'text',
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
  // "Eliminar" == ocultar para mí (no borra para la otra parte).
  const { error } = await sb.rpc('hide_conversation', { p_conversation_id: conversationId });
  if (error) {
    const msg = `${error.message ?? ''} ${(error as { details?: string }).details ?? ''}`.toLowerCase();
    if (
      msg.includes('hide_conversation') &&
      (msg.includes('does not exist') || msg.includes('function') || msg.includes('rpc'))
    ) {
      throw new Error(
        'No se pudo quitar el chat: falta la RPC `hide_conversation` en Supabase. Ejecutá la migración `20260415212000_conversation_hides.sql`.',
      );
    }
    throw error;
  }
}

export async function sendMessageSupabase(
  conversationId: string,
  text: string,
  type: 'text' | 'budget' = 'text',
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
    .select('id,conversation_id,sender_id,body,created_at')
    .single();

  if (error || !data) throw error ?? new Error('No se pudo enviar el mensaje');

  return {
    id: data.id,
    conversation_id: data.conversation_id,
    sender_id: data.sender_id,
    text: data.body,
    status: 'sent',
    created_at: data.created_at,
  };
}

export async function findOrCreateConversationSupabase(
  workerUserId: string,
  primaryTrade: string,
): Promise<{ conversationId: string; workerDisplayName: string; primaryTrade: string }> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('find_or_create_conversation', {
    p_trabajador_id: workerUserId,
    p_primary_trade: primaryTrade,
  });

  if (error) throw error;
  const convId = data as string;

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
): () => void {
  const sb = getSupabaseClient();
  const channel = sb
    .channel(`messages:${conversationId}`)
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
          type?: 'text' | 'budget';
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
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
