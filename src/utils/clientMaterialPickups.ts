import { normalizeDisplayAddress } from './formatAddress';
import { formatOrderCodeDisplay } from './orderCode';
import {
  formatStoreOpeningHours,
  normalizeStoreOpeningHours,
} from './storeOpeningHours';

export type ClientPickupSection = 'para_retirar' | 'historial';

export type ClientPickupMaterialLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
};

export type ClientPickupCardModel = {
  orderId: string;
  section: ClientPickupSection;
  storeName: string;
  address: string | null;
  openingHoursLabel: string | null;
  /** Código de orden (N° pedido). Nunca el id de la solicitud. */
  orderCode: string | null;
  pin: string | null;
  amountDue: number;
  logistics: string | null;
  pickedUpAt: string | null;
  /** Solo para ordenar. No se muestra como “Disponible desde”. */
  createdAt: string | null;
  materials: ClientPickupMaterialLine[];
};

export type ClientPickupField = {
  label: string;
  value: string;
  emphasize?: boolean;
};

export type ClientPickupCardContent = {
  storeName: string;
  fields: ClientPickupField[];
  logistics: string | null;
  pickedUpLabel: string | null;
  materials: { id: string; line: string }[];
};

type RequestItemRow = {
  description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
};

type QuoteItemRow = {
  id?: string | null;
  client_decision?: string | null;
  variant_label?: string | null;
  alternative_description?: string | null;
  in_stock?: boolean | null;
  request_items?: RequestItemRow | RequestItemRow[] | null;
};

type StoreRow = {
  name?: string | null;
  address?: string | null;
  opening_hours?: unknown;
};

type QuoteRow = {
  freight_type?: string | null;
  stores?: StoreRow | StoreRow[] | null;
  quote_items?: QuoteItemRow[] | null;
};

export type ClientPickupOrderRow = {
  id?: string | null;
  order_code?: string | null;
  status?: string | null;
  deposit_status?: string | null;
  accepted_total?: number | string | null;
  verification_pin?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  include_freight?: boolean | null;
  contact_revealed_at?: string | null;
  quotes?: QuoteRow | QuoteRow[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatPin(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
  if (!digits) return null;
  return digits.padStart(4, '0');
}

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function logisticsLabel(
  freightType: string | null | undefined,
  includeFreight: boolean | null | undefined,
): string | null {
  const type = String(freightType ?? '').toLowerCase();
  if (includeFreight === false || type === 'pickup') return 'Retiro en local';
  if (type === 'free') return 'Flete gratis';
  if (type === 'cost' && includeFreight === true) return 'Flete incluido';
  if (type === 'cost') return 'Retiro en local';
  return null;
}

function isReadyForPickup(row: ClientPickupOrderRow): boolean {
  const status = String(row.status ?? '').toLowerCase();
  if (status === 'cancelled') return false;
  if (status === 'completed' || status === 'deposit_paid') return true;
  const deposit = String(row.deposit_status ?? '').toLowerCase();
  if (deposit === 'paid' || deposit === 'waived') return true;
  return Boolean(row.contact_revealed_at);
}

function sectionOf(row: ClientPickupOrderRow): ClientPickupSection | null {
  if (!isReadyForPickup(row)) return null;
  return String(row.status ?? '').toLowerCase() === 'completed' ? 'historial' : 'para_retirar';
}

function materialLines(items: QuoteItemRow[] | null | undefined): ClientPickupMaterialLine[] {
  const rows = items ?? [];
  const mapped = rows.map((item, index) => {
    const requestItem = one(item.request_items);
    const decision = String(item.client_decision ?? 'pending').toLowerCase();
    const base = (requestItem?.description ?? '').trim() || 'Material';
    const variant = (item.variant_label ?? '').trim();
    const alternative = (item.alternative_description ?? '').trim();
    const extra = item.in_stock === false ? alternative || variant : variant;
    const description =
      extra && extra.toLowerCase() !== base.toLowerCase() ? `${base} (${extra})` : base;
    const quantityRaw = Number(requestItem?.quantity);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
    const unit = (requestItem?.unit ?? '').trim() || 'u';
    return {
      id: String(item.id ?? `item-${index}`),
      description,
      quantity,
      unit,
      decision,
    };
  });

  const accepted = mapped.filter((line) => line.decision === 'accepted');
  const source = accepted.length > 0 ? accepted : mapped.filter((line) => line.decision !== 'rejected');
  return source.map(({ id, description, quantity, unit }) => ({
    id,
    description,
    quantity,
    unit,
  }));
}

export function formatMaterialQty(quantity: number, unit: string): string {
  const q = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const shown = Number.isInteger(q) ? String(q) : String(q);
  return `${shown} ${(unit || 'u').trim() || 'u'}`;
}

export function mapClientPickupOrders(rows: ClientPickupOrderRow[]): ClientPickupCardModel[] {
  const cards: ClientPickupCardModel[] = [];
  for (const row of rows) {
    const orderId = String(row.id ?? '').trim();
    const section = sectionOf(row);
    if (!orderId || !section) continue;

    const quote = one(row.quotes);
    const store = one(quote?.stores);
    const hours = formatStoreOpeningHours(normalizeStoreOpeningHours(store?.opening_hours));
    const address = normalizeDisplayAddress(store?.address ?? '');
    const code = formatOrderCodeDisplay(row.order_code);
    const includeFreight =
      row.include_freight == null ? null : Boolean(row.include_freight);

    cards.push({
      orderId,
      section,
      storeName: (store?.name ?? '').trim() || 'Comercio',
      address: address || null,
      openingHoursLabel: hours || null,
      orderCode: code && code !== '—' ? code : null,
      pin: section === 'para_retirar' ? formatPin(row.verification_pin) : null,
      amountDue: Number(row.accepted_total) || 0,
      logistics: logisticsLabel(quote?.freight_type, includeFreight),
      pickedUpAt: section === 'historial' ? row.completed_at ?? null : null,
      createdAt: row.created_at ?? null,
      materials: materialLines(quote?.quote_items),
    });
  }

  cards.sort((a, b) => {
    const aIso = a.section === 'historial' ? a.pickedUpAt ?? a.createdAt : a.createdAt;
    const bIso = b.section === 'historial' ? b.pickedUpAt ?? b.createdAt : b.createdAt;
    const aTime = aIso ? new Date(aIso).getTime() : 0;
    const bTime = bIso ? new Date(bIso).getTime() : 0;
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });

  return cards;
}

/** Textos que renderiza la tarjeta. No incluye fecha de disponibilidad ni N° de solicitud. */
export function buildClientPickupCardContent(card: ClientPickupCardModel): ClientPickupCardContent {
  const fields: ClientPickupField[] = [];
  if (card.address) fields.push({ label: 'Dirección', value: card.address });
  if (card.openingHoursLabel) fields.push({ label: 'Horario', value: card.openingHoursLabel });
  if (card.orderCode) fields.push({ label: 'N° pedido', value: card.orderCode });
  if (card.section === 'para_retirar' && card.pin) {
    fields.push({ label: 'PIN de retiro', value: card.pin, emphasize: true });
  }
  const pickedUp = formatDay(card.pickedUpAt);
  return {
    storeName: card.storeName,
    fields,
    logistics: card.logistics,
    pickedUpLabel: pickedUp ? `Retirado el ${pickedUp}` : null,
    materials: card.materials.map((item) => ({
      id: item.id,
      line: `${item.description} · ${formatMaterialQty(item.quantity, item.unit)}`,
    })),
  };
}
