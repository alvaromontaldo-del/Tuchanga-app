import { getSupabaseClient } from '../lib/supabase';

export type StoreTopMaterial = {
  description: string;
  unit: string;
  quantity: number;
  sales: number;
};

/** Respuesta de `get_store_stats`. Sin datos de clientes, PIN ni direcciones. */
export type StoreStats = {
  from: string;
  to: string;
  has_store: boolean;
  earnings: number;
  sales_count: number;
  avg_ticket: number;
  quotes_sent: number;
  quotes_closed: number;
  close_rate: number | null;
  top_materials: StoreTopMaterial[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('invalid_stats');
    }
    return asRecord(parsed);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_stats');
  }
  return value as Record<string, unknown>;
}

/** Postgres a veces entrega `numeric` como string. */
function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error('invalid_stats');
}

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  return asNumber(value);
}

function asBoolean(value: unknown): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('invalid_stats');
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value == null) return '';
  throw new Error('invalid_stats');
}

function asMaterials(value: unknown): StoreTopMaterial[] {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      throw new Error('invalid_stats');
    }
  }
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error('invalid_stats');
  return list.map((item) => {
    const row = asRecord(item);
    return {
      description: asText(row.description),
      unit: asText(row.unit),
      quantity: asNumber(row.quantity),
      sales: asNumber(row.sales),
    };
  });
}

export function normalizeStoreStats(raw: unknown): StoreStats {
  const row = asRecord(raw);
  return {
    from: asText(row.from),
    to: asText(row.to),
    has_store: asBoolean(row.has_store),
    earnings: asNumber(row.earnings),
    sales_count: asNumber(row.sales_count),
    avg_ticket: asNumber(row.avg_ticket),
    quotes_sent: asNumber(row.quotes_sent),
    quotes_closed: asNumber(row.quotes_closed),
    close_rate: asNullableNumber(row.close_rate),
    top_materials: asMaterials(row.top_materials),
  };
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return '';
}

export async function fetchStoreStats(from: string, to: string): Promise<StoreStats> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('get_store_stats', { p_from: from, p_to: to });
  if (error) {
    const msg = errorText(error);
    if (msg.includes('not_authenticated')) {
      throw new Error('Tenés que iniciar sesión para ver estos datos.');
    }
    if (msg.includes('range_too_long')) {
      throw new Error('El período no puede superar 366 días.');
    }
    if (msg.includes('invalid_range')) {
      throw new Error('El rango de fechas no es válido.');
    }
    throw new Error('No se pudieron cargar los datos de gestión.');
  }
  return normalizeStoreStats(data);
}
