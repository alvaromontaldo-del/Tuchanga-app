import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';
import { redactOffplatformMessage } from '../utils/offplatformContact';
import { removeSupabaseRealtimeTopic, removeSupabaseRealtimeTopicAsync } from '../lib/supabaseRealtime';
import { jobKeepsChatOpen } from '../utils/claimChatVisibility';
import { claimInboxRowLabel, warrantyClaimEventFecha } from '../utils/warrantyClaimChat';
import { dedupeInboxByPeer } from '../utils/inboxPeers';
import { professionalDisplayNameForClient } from '../utils/professionalDisplayName';
import { mapChatSendError } from '../utils/chatErrors';
import type { ApiConversation, ApiMessage, ConversationRole } from './chatApi';
import type { InboxRealtimeEvent } from './inboxState';

function firstNameOnly(name: string): string {
  const s = (name ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return 'Usuario';
  const parts = s.split(' ').filter(Boolean);
  return parts[0] ?? 'Usuario';
}

/** Etiqueta estable del hilo de reclamo. No depende del último mensaje. */
async function loadClaimRowLabels(
  sb: ReturnType<typeof getSupabaseClient>,
  links: Array<{ conversationId: string; contratacionId: string }>,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (!links.length) return labels;
  const { data, error } = await sb
    .from('contrataciones')
    .select('id, service_detail, fecha_trabajo, finalizado_at, created_at')
    .in(
      'id',
      links.map((link) => link.contratacionId),
    );
  if (error || !data) {
    for (const link of links) labels.set(link.conversationId, 'Reclamo');
    return labels;
  }
  const byId = new Map(
    (data as Array<{
      id: string;
      service_detail?: string | null;
      fecha_trabajo?: string | null;
      finalizado_at?: string | null;
      created_at?: string | null;
    }>).map((row) => [row.id, row]),
  );
  for (const link of links) {
    const job = byId.get(link.contratacionId);
    if (!job) {
      labels.set(link.conversationId, 'Reclamo');
      continue;
    }
    labels.set(
      link.conversationId,
      claimInboxRowLabel({
        serviceDetail: job.service_detail,
        fecha: warrantyClaimEventFecha({
          fechaTrabajo: job.fecha_trabajo,
          finalizadoAt: job.finalizado_at,
          createdAt: job.created_at,
        }),
      }),
    );
  }
  return labels;
}

export { dedupeInboxByPeer };

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

/** Cierra hilos generales duplicados. No toca un reclamo ni un trabajo que sigue en uso. */
async function softDeleteSiblingConversations(
  sb: ReturnType<typeof getSupabaseClient>,
  clienteId: string,
  trabajadorId: string,
  keepId?: string | null,
): Promise<void> {
  const { data: siblings, error } = await sb
    .from('conversations')
    .select('id, contratacion_id')
    .eq('cliente_id', clienteId)
    .eq('trabajador_id', trabajadorId)
    .is('deleted_at', null);
  if (error || !siblings) return;
  for (const s of siblings as Array<{ id: string; contratacion_id?: string | null }>) {
    if (!s?.id || (keepId && s.id === keepId) || s.contratacion_id) continue;
    const { data: jobs, error: jobErr } = await sb
      .from('contrataciones')
      .select('estado_trabajo, is_claim_open, claim_status')
      .eq('conversation_id', s.id);
    if (jobErr || !jobs) continue;
    const keeps = (jobs as Array<{
      estado_trabajo?: string | null;
      is_claim_open?: boolean | null;
      claim_status?: string | null;
    }>).some((job) =>
      jobKeepsChatOpen({
        estado_trabajo: job.estado_trabajo,
        is_claim_open: job.is_claim_open,
        claim_status: job.claim_status,
      }),
    );
    if (keeps) continue;
    await forceSoftDeleteConversation(sb, s.id);
  }
}

export async function fetchConversationsSupabase(): Promise<ApiConversation[]> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  type ConversationInboxRow = {
    id: string;
    cliente_id: string;
    trabajador_id: string;
    primary_trade: string | null;
    updated_at: string | null;
    deleted_at: string | null;
    contratacion_id: string | null;
  };

  const withClaim = await sb
    .from('conversations')
    .select('id,cliente_id,trabajador_id,primary_trade,updated_at,deleted_at,contratacion_id')
    .or(`cliente_id.eq.${user.id},trabajador_id.eq.${user.id}`)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  let error = withClaim.error;
  let convs: ConversationInboxRow[] | null = withClaim.data;
  if (error && /contratacion_id/i.test(error.message ?? '')) {
    const fallback = await sb
      .from('conversations')
      .select('id,cliente_id,trabajador_id,primary_trade,updated_at,deleted_at')
      .or(`cliente_id.eq.${user.id},trabajador_id.eq.${user.id}`)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    error = fallback.error;
    convs = (fallback.data ?? []).map((row) => ({
      id: row.id,
      cliente_id: row.cliente_id,
      trabajador_id: row.trabajador_id,
      primary_trade: row.primary_trade,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      contratacion_id: null,
    }));
  }

  if (error || !convs?.length) return [];

  // Defensa: nunca listar soft-deleted aunque el filtro PostgREST falle / schema cache viejo.
  const activeConvs = (convs as Array<{
    id: string;
    cliente_id: string;
    trabajador_id: string;
    primary_trade?: string | null;
    updated_at?: string | null;
    deleted_at?: string | null;
    contratacion_id?: string | null;
  }>).filter((c) => !c.deleted_at);

  if (!activeConvs.length) return [];

  const claimLabelByConversation = await loadClaimRowLabels(
    sb,
    activeConvs
      .filter((c) => c.contratacion_id)
      .map((c) => ({ conversationId: c.id, contratacionId: c.contratacion_id as string })),
  );

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
      .select('nombre,avatar_url')
      .eq('id', otherId)
      .maybeSingle();
    const profile = prof as {
      nombre?: string | null;
      avatar_url?: string | null;
    } | null;
    const name =
      myRole === 'cliente'
        ? professionalDisplayNameForClient(profile?.nombre)
        : firstNameOnly(profile?.nombre ?? 'Usuario');

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

    results.push({
      id: c.id,
      otherUserId: otherId,
      otherDisplayName: name,
      otherAvatarUrl: (prof as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      primaryTrade,
      claimRowLabel: claimLabelByConversation.get(c.id) ?? null,
      lastMessage: last?.type === 'image' ? '📷 Foto' : last?.body ?? null,
      lastMessageAt: last?.created_at ?? null,
      lastMessageSenderId: last?.sender_id ?? null,
      peerReadAt: peerReadById.get(c.id) ?? null,
      unreadCount: unreadById.get(c.id) ?? 0,
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

  const safe =
    type === 'system'
      ? { body: text, metadata }
      : redactOffplatformMessage(type, text, metadata);

  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: safe.body,
      type,
      metadata: (safe.metadata ?? {}) as Record<string, unknown>,
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
    .select('nombre')
    .eq('id', workerUserId)
    .maybeSingle();
  const workerDisplayName = professionalDisplayNameForClient(
    (prof as { nombre?: string | null } | null)?.nombre,
  );

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
        try {
          const row = payload?.new as {
            id?: string;
            conversation_id?: string;
            sender_id?: string;
            body?: string;
            type?: ApiMessage['type'];
            metadata?: Record<string, unknown>;
            created_at?: string;
          } | null;
          if (!row?.id || !row.conversation_id || !row.sender_id || !row.created_at) return;
          onInsert({
            id: row.id,
            conversation_id: row.conversation_id,
            sender_id: row.sender_id,
            text: String(row.body ?? ''),
            status: 'sent',
            created_at: row.created_at,
            type: row.type ?? 'text',
            metadata: row.metadata ?? {},
          });
        } catch (e) {
          console.warn('[realtime messages insert]', e);
        }
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
        try {
          const row = payload?.new as {
            id?: string;
            conversation_id?: string;
            sender_id?: string;
            body?: string;
            type?: ApiMessage['type'];
            metadata?: Record<string, unknown>;
            created_at?: string;
          } | null;
          if (!row?.id || !row.conversation_id || !row.sender_id || !row.created_at) return;
          onUpdate({
            id: row.id,
            conversation_id: row.conversation_id,
            sender_id: row.sender_id,
            text: String(row.body ?? ''),
            status: 'sent',
            created_at: row.created_at,
            type: row.type ?? 'text',
            metadata: row.metadata ?? {},
          });
        } catch (e) {
          console.warn('[realtime messages update]', e);
        }
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

  const emit = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.warn('[realtime inbox]', e);
    }
  };

  const attach = async () => {
    try {
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
            emit(() => {
              const row = payload?.new as { id?: string } | null;
              if (!row?.id) return;
              onEvent({ type: 'conversation_activity', conversationId: row.id });
            });
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
            emit(() => {
              const row = payload?.new as { id?: string } | null;
              if (!row?.id) return;
              onEvent({ type: 'conversation_activity', conversationId: row.id });
            });
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            emit(() => {
              const row = payload?.new as {
                id?: string;
                conversation_id?: string;
                sender_id?: string;
                body?: string;
                created_at?: string;
              } | null;
              if (!row?.conversation_id || !row.sender_id || !row.created_at) return;
              onEvent({
                type: 'message',
                conversationId: row.conversation_id,
                senderId: row.sender_id,
                body: String(row.body ?? ''),
                createdAt: row.created_at,
                messageId: row.id,
              });
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
            emit(() => {
              const row = (payload?.new ?? payload?.old) as {
                conversation_id?: string;
                user_id?: string;
                read_at?: string;
              } | null;
              if (!row?.conversation_id || !row.read_at) return;
              onEvent({
                type: 'read',
                conversationId: row.conversation_id,
                userId: row.user_id ?? userId,
                readAt: row.read_at,
              });
            });
          },
        );

      channel.subscribe((status) => {
        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          scheduleReconnect();
        }
      });
    } catch (e) {
      console.warn('[realtime inbox attach]', e);
      scheduleReconnect();
    }
  };

  void attach();

  return () => {
    cancelled = true;
    clearReconnectTimer();
    if (channel) void sb.removeChannel(channel);
    channel = null;
  };
}

const ROUNDED_KM = /^\d+(,\d)?$/;

/**
 * Km ya redondeados por `distancia_aprox_chat`. NULL si la RPC no está,
 * el que llama no es el profesional, o falta una ubicación. No trae coordenadas.
 */
export async function fetchApproxChatDistanceKm(conversationId: string): Promise<string | null> {
  const id = conversationId.trim();
  if (!id) return null;
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.rpc('distancia_aprox_chat', {
      p_conversation_id: id,
    });
    if (error || typeof data !== 'string') return null;
    const value = data.trim();
    if (!value) return null;
    if (value === 'menos de 1 km' || ROUNDED_KM.test(value)) return value;
    return null;
  } catch {
    return null;
  }
}
