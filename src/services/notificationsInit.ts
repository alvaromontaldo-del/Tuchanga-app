import * as Notifications from 'expo-notifications';
import { getActiveConversationForNotifications } from './chatFocus';

/**
 * Evita duplicidad visual: si la app está en foreground y el usuario está
 * dentro de la conversación activa, no mostramos alerta.
 *
 * Nota: si la app está en background, iOS/Android mostrarán el push igualmente
 * (no se puede suprimir del lado cliente una vez enviado).
 */
export function initNotificationHandlerOnce() {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      try {
        const data = (n.request.content.data ?? {}) as Record<string, unknown>;
        const convId = typeof data.conversationId === 'string' ? data.conversationId : null;
        const active = getActiveConversationForNotifications();
        const isActiveConversation = Boolean(convId && active && convId === active);
        return {
          shouldShowAlert: !isActiveConversation,
          shouldPlaySound: !isActiveConversation,
          shouldSetBadge: true,
        };
      } catch {
        return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true };
      }
    },
  });
}

