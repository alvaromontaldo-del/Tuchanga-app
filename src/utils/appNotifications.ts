/** Avisos oficiales de YaChanga (#218). No incluye chat ni pedidos operativos. */

export type AppNotificationAudience = 'cliente' | 'profesional' | 'comercio';

export type SessionRoleLike = 'client' | 'professional' | 'commerce' | string | null | undefined;

export type AppNotificationRow = {
  id: string;
  audience: AppNotificationAudience;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  storeId: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Tipos que hoy se guardan en el inbox (primera versión, ejemplos de la tarjeta). */
export const APP_NOTIFICATION_INBOX_TYPES = [
  'store_approved',
  'store_rejected',
  'store_trial_notice_10',
  'store_trial_notice_20',
  'professional_aprobado',
] as const;

export type AppNotificationInboxType = (typeof APP_NOTIFICATION_INBOX_TYPES)[number];

export const APP_NOTIFICATION_CATALOG: {
  type: string;
  audience: AppNotificationAudience | 'varios';
  title: string;
  inInbox: boolean;
  notes: string;
}[] = [
  { type: 'store_approved', audience: 'comercio', title: 'Comercio aprobado', inInbox: true, notes: 'Pedido en la tarjeta. Ya tenía push.' },
  { type: 'store_rejected', audience: 'comercio', title: 'Comercio no aprobado', inInbox: true, notes: 'Pedido en la tarjeta. Ahora también entra al inbox y se manda push.' },
  { type: 'store_trial_notice_20', audience: 'comercio', title: 'Quedan 20 días de prueba', inInbox: true, notes: 'Pedido en la tarjeta. El aviso diario ya existente también queda en el inbox.' },
  { type: 'store_trial_notice_10', audience: 'comercio', title: 'Quedan 10 días de prueba (o menos)', inInbox: true, notes: 'Pedido en la tarjeta.' },
  { type: 'professional_aprobado', audience: 'profesional', title: 'Perfil profesional aprobado', inInbox: true, notes: 'Pedido en la tarjeta. En esta versión entra al inbox (todavía no hay push de este evento).' },
  { type: 'professional_rechazado', audience: 'profesional', title: 'Perfil profesional no aprobado', inInbox: false, notes: 'Aún no está en esta primera versión. No tiene push hoy.' },
  { type: 'professional_desactivado', audience: 'profesional', title: 'Perfil profesional desactivado', inInbox: false, notes: 'Aún no está en esta primera versión. No tiene push hoy.' },
  { type: 'matricula_aprobada', audience: 'profesional', title: 'Matrícula verificada', inInbox: false, notes: 'Aún no está en esta primera versión. No tiene push hoy.' },
  { type: 'matricula_rechazada', audience: 'profesional', title: 'Matrícula rechazada', inInbox: false, notes: 'Ya genera push. Aún no está en el inbox de esta primera versión.' },
  { type: 'matricula_fotos_rechazadas', audience: 'profesional', title: 'Fotos de la matrícula rechazadas', inInbox: false, notes: 'Ya genera push. Aún no está en el inbox de esta primera versión.' },
  { type: 'antecedentes_aprobados', audience: 'profesional', title: 'Antecedentes verificados', inInbox: false, notes: 'Aún no está en esta primera versión. No tiene push hoy.' },
  { type: 'antecedentes_rechazados', audience: 'profesional', title: 'Antecedentes rechazados', inInbox: false, notes: 'Ya genera push. Aún no está en el inbox de esta primera versión.' },
  { type: 'chat_message', audience: 'varios', title: 'Mensaje de chat', inInbox: false, notes: 'Sigue en Mensajes. No se mezcla con la campanita.' },
  { type: 'quote_or_review', audience: 'varios', title: 'Cotización o reseña', inInbox: false, notes: 'Sigue en chat / perfil. Se puede agregar después.' },
  { type: 'store_board', audience: 'comercio', title: 'Pedido de materiales (tablero)', inInbox: false, notes: 'Sigue en Pedidos y en la push del tablero.' },
  { type: 'payment_or_pin', audience: 'varios', title: 'Pago, seña o PIN de retiro', inInbox: false, notes: 'No se muestra el desglose de plata al profesional ni el PIN al comercio.' },
];

export function audiencesForAppNotifications(input: {
  isCommerceShell: boolean;
}): AppNotificationAudience[] {
  if (input.isCommerceShell) return ['comercio'];
  return ['cliente', 'profesional'];
}

export function isOfficialStorePushKind(kind: string | null | undefined): boolean {
  const k = String(kind ?? '').trim();
  return (
    k === 'store_approved' ||
    k === 'store_rejected' ||
    k === 'store_trial_notice_10' ||
    k === 'store_trial_notice_20'
  );
}

export type AppNotificationRoute =
  | { shell: 'commerce'; screen: 'AppNotifications' }
  | { shell: 'main'; screen: 'AppNotifications' }
  | { shell: 'main'; screen: 'WorkerABM' };

export function routeForAppNotification(type: string, isCommerceShell: boolean): AppNotificationRoute {
  if (
    type === 'store_approved' ||
    type === 'store_rejected' ||
    type === 'store_trial_notice_10' ||
    type === 'store_trial_notice_20'
  ) {
    return { shell: 'commerce', screen: 'AppNotifications' };
  }
  if (
    type === 'professional_aprobado' ||
    type === 'professional_rechazado' ||
    type === 'professional_desactivado' ||
    type === 'matricula_aprobada' ||
    type === 'matricula_rechazada' ||
    type === 'matricula_fotos_rechazadas' ||
    type === 'antecedentes_aprobados' ||
    type === 'antecedentes_rechazados'
  ) {
    return { shell: 'main', screen: 'WorkerABM' };
  }
  return isCommerceShell
    ? { shell: 'commerce', screen: 'AppNotifications' }
    : { shell: 'main', screen: 'AppNotifications' };
}

export function parseAppNotificationRow(raw: unknown): AppNotificationRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const audience = row.audience;
  const type = typeof row.type === 'string' ? row.type : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const body = typeof row.body === 'string' ? row.body.trim() : '';
  const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
  if (!id || !type || !title || !body || !createdAt) return null;
  if (audience !== 'cliente' && audience !== 'profesional' && audience !== 'comercio') return null;
  const data =
    row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {};
  return {
    id,
    audience,
    type,
    title,
    body,
    data,
    storeId: typeof row.store_id === 'string' ? row.store_id : null,
    readAt: typeof row.read_at === 'string' ? row.read_at : null,
    createdAt,
  };
}

/** El listado nunca debería traer datos sensibles; se usa en tests de regresión. */
export const APP_NOTIFICATION_FORBIDDEN_KEYS = ['apellido', 'pin', 'saldo', 'dni'] as const;
