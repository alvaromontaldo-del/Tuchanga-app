import { normalizeDisplayAddress } from './formatAddress';
import { formatPostDate } from './formatDate';
import { formatOrderCodeDisplay } from './orderCode';
import {
  formatStoreOpeningHours,
  normalizeStoreOpeningHours,
  type StoreHoursSlot,
} from './storeOpeningHours';

export type ClientPickupSection = 'para_retirar' | 'historial';

export type ClientPickupMaterialLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  /** Marca o variante, si la cotización la trae. */
  brand: string | null;
};

export type ClientPickupCardModel = {
  orderId: string;
  section: ClientPickupSection;
  storeName: string;
  title: string;
  address: string | null;
  openingHoursLabel: string | null;
  /** Código de orden (N° pedido). Nunca el id de la solicitud. */
  orderCode: string | null;
  pin: string | null;
  amountDue: number;
  includeFreight: boolean | null;
  deliveryMode: string | null;
  /** Fecha que se muestra como “Fecha de disponibilidad”. No es “Disponible desde”. */
  availableAt: string | null;
  pickedUpAt: string | null;
  /** Solo para ordenar. */
  createdAt: string | null;
  materials: ClientPickupMaterialLine[];
};

export type ClientPickupField = {
  label: string;
  value: string;
};

export type ClientPickupCardContent = {
  storeName: string;
  title: string;
  orderCode: string | null;
  fields: ClientPickupField[];
  pin: string | null;
  pinDisplay: string | null;
  pinHint: string | null;
  pinUsed: boolean;
  materials: { id: string; line: string }[];
};

type RequestItemRow = {
  id?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  sort_order?: number | null;
  variant_label?: string | null;
  brand?: string | null;
};

type QuoteItemRow = {
  id?: string | null;
  client_decision?: string | null;
  variant_label?: string | null;
  alternative_description?: string | null;
  in_stock?: boolean | null;
  request_item_id?: string | null;
  request_items?: RequestItemRow | RequestItemRow[] | null;
};

type StoreRow = {
  name?: string | null;
  address?: string | null;
  opening_hours?: unknown;
};

type RequestRow = {
  id?: string | null;
  title?: string | null;
  request_items?: RequestItemRow[] | null;
};

type QuoteRow = {
  freight_type?: string | null;
  stores?: StoreRow | StoreRow[] | null;
  quote_items?: QuoteItemRow[] | null;
  material_requests?: RequestRow | RequestRow[] | null;
};

export type ClientPickupOrderRow = {
  id?: string | null;
  order_id?: string | null;
  order_code?: string | null;
  numero_pedido?: string | null;
  freight_type?: string | null;
  /** Id corto interno. Se ignora al armar la tarjeta. */
  numero_solicitud?: string | null;
  request_id?: string | null;
  status?: string | null;
  order_status?: string | null;
  list_bucket?: string | null;
  deposit_status?: string | null;
  accepted_total?: number | string | null;
  verification_pin?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  available_at?: string | null;
  include_freight?: boolean | null;
  contact_revealed_at?: string | null;
  title?: string | null;
  store_name?: string | null;
  store_address?: string | null;
  store_opening_hours?: unknown;
  items?: RequestItemRow[] | null;
  quotes?: QuoteRow | QuoteRow[] | null;
};

const WEEKDAY_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

const WEEKDAY_INDEX: Record<string, number> = {
  lun: 1,
  lunes: 1,
  mon: 1,
  monday: 1,
  mar: 2,
  martes: 2,
  tue: 2,
  tuesday: 2,
  mie: 3,
  miercoles: 3,
  wed: 3,
  wednesday: 3,
  jue: 4,
  jueves: 4,
  thu: 4,
  thursday: 4,
  vie: 5,
  viernes: 5,
  fri: 5,
  friday: 5,
  sab: 6,
  sabado: 6,
  sat: 6,
  saturday: 6,
  dom: 7,
  domingo: 7,
  sun: 7,
  sunday: 7,
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dayNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw === 0) return 7;
    if (raw >= 1 && raw <= 7) return raw;
  }
  const key = stripAccents(String(raw ?? '').trim().toLowerCase());
  return WEEKDAY_INDEX[key] ?? null;
}

function formatStoreWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  if (sorted.length === 7) return 'Todos los días';
  const isWeek =
    sorted.length === 5 && sorted.every((day, index) => day === index + 1);
  if (isWeek) return 'Lun a Vie';
  const isUntilSaturday =
    sorted.length === 6 && sorted[0] === 1 && sorted[5] === 6;
  if (isUntilSaturday) return 'Lun a Sáb';
  return sorted.map((day) => WEEKDAY_SHORT[day]).join(', ');
}

function formatSlotsLine(slots: StoreHoursSlot[]): string {
  return slots.map((slot) => `${slot.open} a ${slot.close}`).join(' y de ');
}

function slotsFromUnknown(raw: unknown): StoreHoursSlot[] {
  if (Array.isArray(raw)) return normalizeStoreOpeningHours(raw);
  const record = asRecord(raw);
  if (record && (record.open || record.close)) return normalizeStoreOpeningHours([record]);
  return [];
}

function scheduleRows(raw: unknown): { day: number; slots: StoreHoursSlot[] }[] | null {
  const record = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.schedule)
      ? (record.schedule as unknown[])
      : Array.isArray(record?.days)
        ? (record.days as unknown[])
        : null;
  if (!list) return null;
  const rows: { day: number; slots: StoreHoursSlot[] }[] = [];
  for (const entry of list) {
    const obj = asRecord(entry);
    if (!obj) continue;
    const day = dayNumber(obj.day ?? obj.weekday ?? obj.dia);
    if (day == null) continue;
    const slots = slotsFromUnknown(obj.slots ?? obj.hours ?? (obj.open ? [obj] : []));
    rows.push({ day, slots });
  }
  return rows.length > 0 ? rows : null;
}

/** Horario del comercio. Acepta franjas simples o la grilla semanal (Lun a Vie · Dom: cerrado). */
export function formatPickupOpeningHours(raw: unknown): string | null {
  const schedule = scheduleRows(raw);
  if (!schedule) {
    const text = formatStoreOpeningHours(normalizeStoreOpeningHours(raw));
    return text || null;
  }
  const open = schedule.filter((row) => row.slots.length > 0);
  if (open.length === 0) return 'Cerrado todos los días';

  const groups = new Map<string, { days: number[]; slots: StoreHoursSlot[] }>();
  for (const row of open) {
    const key = row.slots.map((slot) => `${slot.open}-${slot.close}`).join('|');
    const group = groups.get(key) ?? { days: [], slots: row.slots };
    group.days.push(row.day);
    groups.set(key, group);
  }

  const parts: string[] = [];
  for (const group of groups.values()) {
    const days = formatStoreWeekdays(group.days);
    const hours = formatSlotsLine(group.slots);
    if (days && hours) parts.push(`${days}: ${hours}`);
  }

  const closed = schedule.filter((row) => row.slots.length === 0).map((row) => row.day);
  if (closed.length > 0 && closed.length < 7) {
    const days = formatStoreWeekdays(closed);
    if (days) parts.push(`${days}: cerrado`);
  }

  return parts.join(' · ') || null;
}

export function deliveryModeLabel(
  includeFreight: boolean | null | undefined,
  freightType: string | null | undefined,
): string {
  const type = String(freightType ?? '').toLowerCase();
  if (includeFreight === true) {
    return type === 'free' ? 'Flete gratis a domicilio' : 'Flete a domicilio';
  }
  if (includeFreight === false) return 'Retiro en local';
  if (type === 'pickup') return 'Retiro en local';
  if (type === 'free') return 'Flete gratis (pendiente de confirmación)';
  if (type === 'cost') return 'Flete cotizado (pendiente de confirmación)';
  return 'Modalidad no especificada';
}

function formatPin(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
  if (!digits) return null;
  return digits.padStart(4, '0');
}

export function formatPinForCard(pin: string | null | undefined): string | null {
  const formatted = formatPin(pin);
  if (!formatted) return null;
  return formatted.split('').join(' ');
}

function isReadyForPickup(row: ClientPickupOrderRow): boolean {
  const status = String(row.status ?? row.order_status ?? '').toLowerCase();
  if (status === 'cancelled') return false;
  if (status === 'completed' || status === 'deposit_paid') return true;
  const deposit = String(row.deposit_status ?? '').toLowerCase();
  if (deposit === 'paid' || deposit === 'waived') return true;
  return Boolean(row.contact_revealed_at);
}

function sectionOf(row: ClientPickupOrderRow): ClientPickupSection | null {
  const bucket = String(row.list_bucket ?? '').toLowerCase();
  if (bucket === 'historial') return 'historial';
  if (bucket === 'activa' || bucket === 'para_retirar') return 'para_retirar';
  if (!isReadyForPickup(row)) return null;
  const status = String(row.status ?? row.order_status ?? '').toLowerCase();
  return status === 'completed' ? 'historial' : 'para_retirar';
}

function isRpcRow(row: ClientPickupOrderRow): boolean {
  return (
    row.list_bucket != null ||
    row.order_id != null ||
    row.store_name != null ||
    row.numero_pedido != null ||
    Array.isArray(row.items)
  );
}

function brandFromQuoteItem(item: QuoteItemRow): string | null {
  const variant = (item.variant_label ?? '').trim();
  const alternative = (item.alternative_description ?? '').trim();
  const extra = item.in_stock === false ? alternative || variant : variant;
  return extra || null;
}

function lineFromParts(
  id: string,
  description: string,
  quantityRaw: number,
  unitRaw: string,
  brand: string | null,
): ClientPickupMaterialLine {
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
  const unit = unitRaw.trim() || 'u';
  const cleanBrand = brand && brand.toLowerCase() !== description.toLowerCase() ? brand : null;
  return { id, description, quantity, unit, brand: cleanBrand };
}

function linesFromQuoteItems(items: QuoteItemRow[] | null | undefined): ClientPickupMaterialLine[] {
  const mapped = (items ?? []).map((item, index) => {
    const requestItem = one(item.request_items);
    const decision = String(item.client_decision ?? 'pending').toLowerCase();
    const description = (requestItem?.description ?? '').trim() || 'Material';
    const quantityRaw = Number(requestItem?.quantity);
    const unit = (requestItem?.unit ?? '').trim() || 'u';
    return {
      line: lineFromParts(
        String(item.id ?? requestItem?.id ?? `item-${index}`),
        description,
        quantityRaw,
        unit,
        brandFromQuoteItem(item),
      ),
      decision,
      requestItemId: String(item.request_item_id ?? requestItem?.id ?? ''),
    };
  });
  const accepted = mapped.filter((line) => line.decision === 'accepted');
  const source = accepted.length > 0 ? accepted : mapped.filter((line) => line.decision !== 'rejected');
  return source.map((entry) => entry.line);
}

function linesFromRequestItems(
  items: RequestItemRow[] | null | undefined,
  quoteItems: QuoteItemRow[] | null | undefined,
): ClientPickupMaterialLine[] {
  const rows = [...(items ?? [])].sort(
    (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0),
  );
  if (rows.length === 0) return linesFromQuoteItems(quoteItems);

  const quotes = quoteItems ?? [];
  const decisionFor = (id: string) =>
    quotes.filter((item) => {
      const requestItem = one(item.request_items);
      return String(item.request_item_id ?? requestItem?.id ?? '') === id;
    });

  const lines: ClientPickupMaterialLine[] = [];
  rows.forEach((item, index) => {
    const id = String(item.id ?? `item-${index}`);
    const related = decisionFor(id);
    const accepted = related.find(
      (quote) => String(quote.client_decision ?? '').toLowerCase() === 'accepted',
    );
    const rejected =
      related.length > 0 &&
      related.every((quote) => String(quote.client_decision ?? '').toLowerCase() === 'rejected');
    if (rejected && !accepted) return;
    const source = accepted ?? null;
    const description = (item.description ?? '').trim() || 'Material';
    const brand = (item.brand ?? item.variant_label ?? '').trim() || (source ? brandFromQuoteItem(source) : null);
    lines.push(
      lineFromParts(id, description, Number(item.quantity), (item.unit ?? '').trim() || 'u', brand),
    );
  });
  return lines.length > 0 ? lines : linesFromQuoteItems(quoteItems);
}

function orderCodeOf(row: ClientPickupOrderRow): string | null {
  const direct = String(row.numero_pedido ?? '').replace(/\D/g, '');
  if (direct) return direct;
  const code = formatOrderCodeDisplay(row.order_code);
  return code && code !== '—' ? code : null;
}

function availableAtOf(row: ClientPickupOrderRow): string | null {
  const explicit = String(row.available_at ?? '').trim();
  if (explicit) return explicit;
  return row.contact_revealed_at ?? row.updated_at ?? row.created_at ?? null;
}

export function mapClientPickupOrders(rows: ClientPickupOrderRow[]): ClientPickupCardModel[] {
  const cards: ClientPickupCardModel[] = [];
  for (const row of rows) {
    const section = sectionOf(row);
    if (!section) continue;

    if (isRpcRow(row)) {
      const orderId = String(row.order_id ?? row.id ?? '').trim();
      if (!orderId) continue;
      const code = orderCodeOf(row);
      if (!code) continue;
      cards.push({
        orderId,
        section,
        storeName: (row.store_name ?? '').trim() || 'Comercio',
        title: (row.title ?? '').trim() || 'Pedido de materiales',
        address: normalizeDisplayAddress(row.store_address ?? '') || null,
        openingHoursLabel: formatPickupOpeningHours(row.store_opening_hours),
        orderCode: code,
        pin: formatPin(row.verification_pin),
        amountDue: Number(row.accepted_total) || 0,
        includeFreight: row.include_freight == null ? null : Boolean(row.include_freight),
        deliveryMode: deliveryModeLabel(row.include_freight, row.freight_type),
        availableAt: availableAtOf(row),
        pickedUpAt: section === 'historial' ? row.completed_at ?? null : null,
        createdAt: row.available_at ?? row.created_at ?? null,
        materials: linesFromRequestItems(row.items, null),
      });
      continue;
    }

    const orderId = String(row.id ?? '').trim();
    if (!orderId) continue;
    const quote = one(row.quotes);
    const store = one(quote?.stores);
    const request = one(quote?.material_requests);
    const address = normalizeDisplayAddress(store?.address ?? '');
    const code = orderCodeOf(row);
    const includeFreight = row.include_freight == null ? null : Boolean(row.include_freight);

    cards.push({
      orderId,
      section,
      storeName: (store?.name ?? '').trim() || 'Comercio',
      title: (request?.title ?? row.title ?? '').trim() || 'Pedido de materiales',
      address: address || null,
      openingHoursLabel: formatPickupOpeningHours(store?.opening_hours),
      orderCode: code,
      pin: formatPin(row.verification_pin),
      amountDue: Number(row.accepted_total) || 0,
      includeFreight,
      deliveryMode: deliveryModeLabel(includeFreight, quote?.freight_type),
      availableAt: availableAtOf(row),
      pickedUpAt: section === 'historial' ? row.completed_at ?? null : null,
      createdAt: row.created_at ?? null,
      materials: linesFromRequestItems(request?.request_items, quote?.quote_items),
    });
  }

  cards.sort((a, b) => {
    const aIso = a.section === 'historial' ? a.pickedUpAt ?? a.availableAt ?? a.createdAt : a.availableAt ?? a.createdAt;
    const bIso = b.section === 'historial' ? b.pickedUpAt ?? b.availableAt ?? b.createdAt : b.availableAt ?? b.createdAt;
    const aTime = aIso ? new Date(aIso).getTime() : 0;
    const bTime = bIso ? new Date(bIso).getTime() : 0;
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });

  return cards;
}

export function formatMaterialQty(quantity: number, unit: string): string {
  const q = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const shown = Number.isInteger(q) ? String(q) : String(q);
  return `${shown} ${(unit || 'u').trim() || 'u'}`;
}

function materialLineText(item: ClientPickupMaterialLine): string {
  const brand = item.brand ? ` (${item.brand})` : '';
  return `${item.description}${brand} · ${formatMaterialQty(item.quantity, item.unit)}`;
}

function dateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const label = formatPostDate(iso);
  return label || null;
}

/**
 * Textos de la tarjeta de Para retirar / Historial.
 * No incluye “Disponible desde” ni el N° de solicitud.
 */
export function buildClientPickupCardContent(card: ClientPickupCardModel): ClientPickupCardContent {
  const fields: ClientPickupField[] = [];
  fields.push({
    label: 'Dirección del comercio',
    value: card.address || 'Dirección no informada',
  });
  if (card.section === 'para_retirar') {
    const available = dateLabel(card.availableAt);
    if (available) fields.push({ label: 'Fecha de disponibilidad', value: available });
  }
  fields.push({
    label: 'Horario de atención',
    value: card.openingHoursLabel || 'Horario no informado',
  });
  if (card.deliveryMode) fields.push({ label: 'Modalidad de entrega', value: card.deliveryMode });
  if (card.section === 'historial') {
    const pickedUp = dateLabel(card.pickedUpAt);
    if (pickedUp) fields.push({ label: 'Retirado', value: pickedUp });
  }

  const showPin = Boolean(card.pin);
  return {
    storeName: card.storeName,
    title: card.title,
    orderCode: card.orderCode,
    fields,
    pin: showPin ? card.pin : null,
    pinDisplay: showPin ? formatPinForCard(card.pin) : null,
    pinHint:
      card.section === 'para_retirar' && showPin
        ? card.includeFreight === true
          ? 'Mostralo al comercio al recibir el pedido.'
          : 'Mostralo en el comercio al retirar.'
        : null,
    pinUsed: card.section === 'historial' && showPin,
    materials: card.materials.map((item) => ({
      id: item.id,
      line: materialLineText(item),
    })),
  };
}
