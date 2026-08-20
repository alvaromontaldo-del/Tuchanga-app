import * as Notifications from 'expo-notifications';
import { getSupabaseClient } from '../lib/supabase';
import { navigationRef } from '../navigation/navigationRef';

function waitForNavigation(maxMs = 8000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (navigationRef.isReady()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });
}

async function openChatFromPush(conversationId: string): Promise<void> {
  const ready = await waitForNavigation();
  if (!ready) return;

  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) return;

  const { data: conv } = await sb
    .from('conversations')
    .select('id, cliente_id, trabajador_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) {
    navigationRef.navigate('Main', { screen: 'Mensajes' });
    return;
  }

  const clienteId = String((conv as { cliente_id?: string }).cliente_id ?? '');
  const trabajadorId = String((conv as { trabajador_id?: string }).trabajador_id ?? '');
  const myRole = clienteId === user.id ? 'cliente' : 'trabajador';
  const otherId = myRole === 'cliente' ? trabajadorId : clienteId;

  const { data: profile } = await sb
    .from('profiles')
    .select('nombre, apellido')
    .eq('id', otherId)
    .maybeSingle();

  const otherDisplayName = profile
    ? `${String((profile as { nombre?: string }).nombre ?? '').trim()} ${String(
        (profile as { apellido?: string }).apellido ?? '',
      ).trim()}`.trim() || 'Usuario'
    : 'Usuario';

  navigationRef.navigate('Main', {
    screen: 'Mensajes',
    params: {
      screen: 'ChatConversation',
      params: {
        conversationId,
        otherDisplayName,
        headerSubtitle: myRole === 'cliente' ? 'Profesional' : 'Cliente',
        workerId: myRole === 'cliente' ? trabajadorId : undefined,
      },
    },
  });
}

async function openStoreBoardFromPush(data: Record<string, unknown>): Promise<void> {
  const ready = await waitForNavigation();
  if (!ready) return;
  const column = typeof data.column === 'string' ? data.column : 'nuevas';
  navigationRef.navigate('Main', {
    screen: 'StoreMaterialRequests',
    params: {
      initialColumn: column,
      highlightRequestId:
        typeof data.requestId === 'string' ? data.requestId : undefined,
      highlightTargetId: typeof data.targetId === 'string' ? data.targetId : undefined,
    },
  } as never);
}

async function handleNotificationResponse(
  response: Notifications.NotificationResponse | null,
): Promise<void> {
  if (!response) return;
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const conversationId =
    typeof data.conversationId === 'string'
      ? data.conversationId
      : typeof data.conversation_id === 'string'
        ? data.conversation_id
        : null;

  if (conversationId) {
    await openChatFromPush(conversationId);
    return;
  }

  if (data.type === 'store_board' || data.eventType === 'nueva_solicitud') {
    await openStoreBoardFromPush(data);
  }
}

/**
 * Abre chat / tablero comercio al tocar un push (cold start + background).
 */
export function initNotificationRoutingOnce(): void {
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    void handleNotificationResponse(response);
  });
  Notifications.addNotificationResponseReceivedListener((response) => {
    void handleNotificationResponse(response);
  });
}
