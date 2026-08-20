import { getSupabaseClient } from '../lib/supabase';

export type PeerBlockStatus = {
  iBlockedThem: boolean;
  theyBlockedMe: boolean;
};

export const CHAT_REPORT_REASONS = [
  { code: 'estafa', label: 'Intento de estafa' },
  { code: 'conducta', label: 'Comportamiento inapropiado' },
  { code: 'ofensivos', label: 'Mensajes ofensivos' },
  { code: 'contacto_prohibido', label: 'Datos de contacto prohibidos' },
  { code: 'otro', label: 'Otro' },
] as const;

export type ChatReportReasonCode = (typeof CHAT_REPORT_REASONS)[number]['code'];

export async function fetchPeerBlockStatus(peerUserId: string): Promise<PeerBlockStatus> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return { iBlockedThem: false, theyBlockedMe: false };
  if (user.id === peerUserId) return { iBlockedThem: false, theyBlockedMe: false };

  const [byMe, byThem] = await Promise.all([
    sb
      .from('user_blocks')
      .select('blocker_id')
      .eq('blocker_id', user.id)
      .eq('blocked_id', peerUserId)
      .maybeSingle(),
    sb
      .from('user_blocks')
      .select('blocker_id')
      .eq('blocker_id', peerUserId)
      .eq('blocked_id', user.id)
      .maybeSingle(),
  ]);

  if (byMe.error) throw byMe.error;
  if (byThem.error) throw byThem.error;

  return {
    iBlockedThem: Boolean(byMe.data),
    theyBlockedMe: Boolean(byThem.data),
  };
}

export async function blockUserInSupabase(blockedUserId: string): Promise<void> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('No autenticado');
  if (user.id === blockedUserId) throw new Error('No podés bloquearte a vos mismo.');

  const { error } = await sb.from('user_blocks').insert({
    blocker_id: user.id,
    blocked_id: blockedUserId,
  });
  if (error) throw error;
}

export async function unblockUserInSupabase(blockedUserId: string): Promise<void> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('No autenticado');

  const { error } = await sb
    .from('user_blocks')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', blockedUserId);
  if (error) throw error;
}

export async function reportUserInSupabase(params: {
  reportedUserId: string;
  conversationId?: string;
  reason: string;
  details?: string;
}): Promise<void> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('No autenticado');
  if (user.id === params.reportedUserId) throw new Error('No podés reportarte a vos mismo.');

  const { error } = await sb.from('user_reports').insert({
    reporter_id: user.id,
    reported_id: params.reportedUserId,
    conversation_id: params.conversationId ?? null,
    reason: params.reason.trim().slice(0, 120),
    details: (params.details ?? '').trim().slice(0, 800),
  });
  if (error) throw error;
}
