import { getSupabaseClient } from '../lib/supabase';
import type { ApiConversation, ApiMessage, ConversationRole } from './chatApi';

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

  for (const c of convs) {
    const myRole: ConversationRole = c.cliente_id === user.id ? 'cliente' : 'trabajador';
    const otherId = myRole === 'cliente' ? c.trabajador_id : c.cliente_id;
    const { data: prof } = await sb
      .from('profiles')
      .select('nombre,apellido')
      .eq('id', otherId)
      .maybeSingle();
    const name = prof ? `${prof.nombre} ${prof.apellido}`.trim() : 'Usuario';

    const { data: lastMsgs } = await sb
      .from('messages')
      .select('body,created_at')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const last = lastMsgs?.[0];

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
      primaryTrade,
      lastMessage: last?.body ?? null,
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
    .select('id,conversation_id,sender_id,body,created_at')
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
  }));
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
  const workerDisplayName = prof ? `${prof.nombre} ${prof.apellido}`.trim() : 'Profesional';

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
          created_at: string;
        };
        onInsert({
          id: row.id,
          conversation_id: row.conversation_id,
          sender_id: row.sender_id,
          text: row.body,
          status: 'sent',
          created_at: row.created_at,
        });
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
