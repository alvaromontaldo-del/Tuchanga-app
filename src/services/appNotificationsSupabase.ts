import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import {
  parseAppNotificationRow,
  type AppNotificationAudience,
  type AppNotificationRow,
} from '../utils/appNotifications';

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const msg = String((error as { message?: unknown }).message ?? '').trim();
    if (msg) return msg;
  }
  return fallback;
}

export async function listMyAppNotifications(
  audiences: AppNotificationAudience[],
  limit = 50,
): Promise<AppNotificationRow[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('list_my_app_notifications', {
    p_audiences: audiences,
    p_limit: limit,
  });
  if (error) throw new Error(errorMessage(error, 'No se pudieron cargar los avisos.'));
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => parseAppNotificationRow(row))
    .filter((row): row is AppNotificationRow => row != null);
}

export async function countUnreadAppNotifications(
  audiences: AppNotificationAudience[],
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('count_unread_app_notifications', {
    p_audiences: audiences,
  });
  if (error) throw new Error(errorMessage(error, 'No se pudo leer los avisos.'));
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function markAppNotificationRead(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('mark_app_notification_read', { p_id: id });
  if (error) throw new Error(errorMessage(error, 'No se pudo marcar el aviso.'));
  return data === true;
}

export async function markAllAppNotificationsRead(
  audiences: AppNotificationAudience[],
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('mark_all_app_notifications_read', {
    p_audiences: audiences,
  });
  if (error) throw new Error(errorMessage(error, 'No se pudieron marcar los avisos.'));
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
