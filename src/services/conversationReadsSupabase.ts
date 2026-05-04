import { getSupabaseClient } from '../lib/supabase';

export type ConversationReadRow = {
  conversation_id: string;
  user_id: string;
  read_at: string;
};

export async function upsertConversationRead(conversationId: string, readAtIso: string) {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return;

  await sb
    .from('conversation_reads')
    .upsert(
      { conversation_id: conversationId, user_id: user.id, read_at: readAtIso },
      { onConflict: 'conversation_id,user_id' },
    );
}

export async function fetchConversationReads(conversationId: string): Promise<ConversationReadRow[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('conversation_reads')
    .select('conversation_id,user_id,read_at')
    .eq('conversation_id', conversationId);
  if (error || !data) return [];
  return data as ConversationReadRow[];
}

