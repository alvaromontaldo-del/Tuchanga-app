/**
 * Aviso de chat cuando el cliente paga el costo de servicio de materiales.
 *
 * Un checkout puede cubrir varios comercios (una orden por comercio) y todos
 * comparten el chat del trabajo. El alta histórica insertaba una burbuja por
 * orden; acá se muestra una sola.
 *
 * El texto de un solo comercio tiene que coincidir con el de
 * `_notify_material_service_fee_paid` (migración 20260925200000).
 */

export const MATERIAL_SERVICE_FEE_PAID_EVENT = 'material_service_fee_paid';

export const MATERIAL_FEE_PAID_SINGLE_BODY =
  'Costo de servicio YaChanga acreditado. Ya podés ver el comercio, el código y el PIN.';

export const MATERIAL_FEE_PAID_MULTI_BODY =
  'Costo de servicio YaChanga acreditado para todos los comercios. Ya podés ver cada comercio, su código y su PIN.';

export type MaterialFeePaidChatMessage = {
  id: string;
  type?: string;
  text: string;
  created_at: string;
  metadata?: Record<string, unknown> | string | null;
};

function normalizeMetadata(
  metadata: MaterialFeePaidChatMessage['metadata'],
): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  return metadata;
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

function feePaidGroupKey(message: MaterialFeePaidChatMessage): string | null {
  if (message.type !== 'system') return null;
  const meta = normalizeMetadata(message.metadata);
  if (metaString(meta, 'event') !== MATERIAL_SERVICE_FEE_PAID_EVENT) return null;
  const checkoutId = metaString(meta, 'checkout_id');
  if (checkoutId) return `checkout:${checkoutId}`;
  const orderId = metaString(meta, 'order_id');
  if (orderId) return `order:${orderId}`;
  return `msg:${message.id}`;
}

type FeePaidGroup = {
  keepId: string;
  keepAt: number;
  orderIds: Set<string>;
  storeCount: number;
};

function createdAtMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isEarlierKeep(message: MaterialFeePaidChatMessage, group: FeePaidGroup): boolean {
  const at = createdAtMs(message.created_at);
  if (at !== group.keepAt) return at < group.keepAt;
  return message.id < group.keepId;
}

/**
 * Deja un solo aviso `material_service_fee_paid` por checkout (o por orden,
 * si el pago no tiene grupo). Con 2+ comercios distintos, unifica el texto.
 * No reordena el resto del hilo.
 */
export function dedupeMaterialServiceFeePaidMessages<T extends MaterialFeePaidChatMessage>(
  messages: T[],
): T[] {
  const groups = new Map<string, FeePaidGroup>();

  for (const message of messages) {
    const key = feePaidGroupKey(message);
    if (!key) continue;
    const meta = normalizeMetadata(message.metadata);
    const orderId = metaString(meta, 'order_id');
    const storeCount = Number(meta.store_count ?? meta.storeCount) || 0;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, {
        keepId: message.id,
        keepAt: createdAtMs(message.created_at),
        orderIds: new Set(orderId ? [orderId] : []),
        storeCount,
      });
      continue;
    }
    if (orderId) prev.orderIds.add(orderId);
    prev.storeCount = Math.max(prev.storeCount, storeCount);
    if (isEarlierKeep(message, prev)) {
      prev.keepId = message.id;
      prev.keepAt = createdAtMs(message.created_at);
    }
  }

  if (groups.size === 0) return messages;

  return messages.flatMap((message) => {
    const key = feePaidGroupKey(message);
    if (!key) return [message];
    const group = groups.get(key);
    if (!group || message.id !== group.keepId) return [];
    const covered = Math.max(group.storeCount, group.orderIds.size);
    if (covered > 1 && message.text !== MATERIAL_FEE_PAID_MULTI_BODY) {
      return [{ ...message, text: MATERIAL_FEE_PAID_MULTI_BODY }];
    }
    return [message];
  });
}
