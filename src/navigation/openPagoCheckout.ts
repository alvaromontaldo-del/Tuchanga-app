import { getSupabaseClient } from '../lib/supabase';
import { fetchContratacionById } from '../services/contratacionesSupabase';
import { fetchConversationParticipants } from '../services/quotesSupabase';
import { fetchPeerFullName } from '../services/profileIdentitySupabase';
import { professionalDisplayNameForClient } from '../utils/professionalDisplayName';
import { navigationRef } from './navigationRef';

export function openPagoCheckout(params: {
  checkoutUrl: string;
  sandbox?: boolean;
  conversationId?: string;
  contratacionId?: string;
  materialOrderId?: string;
}): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('PagoCheckout', params);
}

export function openPagoRetorno(params: {
  status: 'approved' | 'pending' | 'failure';
  conversationId?: string;
  mpPaymentId?: string;
  contratacionId?: string;
  materialOrderId?: string;
}): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('PagoRetorno', params);
}

export function openDetalleServicio(contratacionId: string, conversationId?: string): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Main', {
    screen: 'Mensajes',
    params: {
      screen: 'DetalleServicio',
      params: { contratacionId, conversationId },
    },
  });
}

export function openMaterialOrderDetail(orderId: string): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Main', {
    screen: 'Mensajes',
    params: {
      screen: 'MaterialOrderDetail',
      params: { orderId },
    },
  });
}

export async function openChatFromContratacion(
  contratacionId: string,
  conversationIdHint?: string,
): Promise<void> {
  if (!navigationRef.isReady()) return;

  const row = await fetchContratacionById(contratacionId);
  if (!row) return;

  const conversationId = conversationIdHint ?? row.conversation_id;

  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return;

  const parts = await fetchConversationParticipants(conversationId);
  if (!parts) return;

  const myRole = parts.cliente_id === user.id ? 'cliente' : 'trabajador';
  const otherId = myRole === 'cliente' ? parts.trabajador_id : parts.cliente_id;

  const { data: profile } = await sb
    .from('profiles')
    .select('nombre')
    .eq('id', otherId)
    .maybeSingle();

  const profileRow = profile as { nombre?: string | null } | null;
  // #120: el apellido del cliente llega por RPC y solo al profesional de ese cliente.
  const peerFullName = myRole === 'cliente' ? null : await fetchPeerFullName(otherId);
  const otherDisplayName =
    myRole === 'cliente'
      ? professionalDisplayNameForClient(profileRow?.nombre)
      : peerFullName || String(profileRow?.nombre ?? '').trim() || 'Usuario';

  const headerSubtitle =
    myRole === 'cliente'
      ? `Profesional${parts.primary_trade ? ` · ${parts.primary_trade}` : ''}`
      : 'Cliente';

  const chatParams = {
    conversationId,
    otherDisplayName,
    headerSubtitle,
    workerId: myRole === 'cliente' ? parts.trabajador_id : undefined,
  };

  navigationRef.navigate('Main', {
    screen: 'Mensajes',
    params: {
      screen: 'ChatConversation',
      params: chatParams,
    },
  });
}
