import { getSupabaseClient } from '../lib/supabase';
import {
  mapClientPickupOrders,
  mergeStoreQuoteDetails,
  pickupItemsDeclareDecision,
  type ClientPickupCardModel,
  type ClientPickupOrderRow,
} from '../utils/clientMaterialPickups';

const ORDER_COLUMNS = `
  id,
  order_code,
  status,
  deposit_status,
  accepted_total,
  created_at,
  updated_at,
  completed_at,
  include_freight,
  contact_revealed_at
`;

const QUOTE_EMBED = `
  freight_type,
  stores ( name, opening_hours ),
  material_requests (
    id,
    title,
    request_items ( id, description, quantity, unit, sort_order )
  ),
  quote_items (
    id,
    client_decision,
    variant_label,
    alternative_description,
    in_stock,
    request_item_id,
    request_items ( id, description, quantity, unit )
  )
`;

const SELECT_OWN = `${ORDER_COLUMNS}, quotes ( ${QUOTE_EMBED} )`;
const SELECT_BY_QUOTE_CLIENT = `${ORDER_COLUMNS}, quotes!inner ( ${QUOTE_EMBED} )`;

/** Cotización del pedido, para recortar materiales cuando la RPC manda el pedido entero. */
const SELECT_STORE_QUOTES = `
  id,
  quotes (
    quote_items (
      id,
      client_decision,
      variant_label,
      alternative_description,
      in_stock,
      variant_index,
      request_item_id,
      request_items ( id, description, quantity, unit, sort_order )
    )
  )
`;

function rowsFromRpc(data: unknown): ClientPickupOrderRow[] | null {
  if (!Array.isArray(data)) return null;
  return data as ClientPickupOrderRow[];
}

type OrderRevealRow = {
  contact_revealed?: boolean;
  verification_pin?: string | null;
  store_address?: string | null;
  store_phone?: string | null;
  store_name?: string | null;
};

/** Pega teléfono/dirección/PIN que devolvió get_material_order_reveal (solo post-fee). */
function applyOrderReveal(row: ClientPickupOrderRow, reveal: OrderRevealRow): ClientPickupOrderRow {
  if (!reveal.contact_revealed) return row;
  const address = reveal.store_address ?? null;
  const quotes = row.quotes;
  let nextQuotes = quotes;
  if (quotes && !Array.isArray(quotes)) {
    const stores = quotes.stores;
    if (stores && !Array.isArray(stores)) {
      nextQuotes = { ...quotes, stores: { ...stores, address } };
    }
  }
  const storeName = reveal.store_name?.trim();
  return {
    ...row,
    quotes: nextQuotes,
    store_address: address ?? row.store_address ?? null,
    store_name:
      storeName && !storeName.includes('oculto') ? storeName : row.store_name,
    store_phone: reveal.store_phone ?? null,
    verification_pin: reveal.verification_pin ?? null,
  };
}

/**
 * El select directo no pide verification_pin ni stores.address.
 * Esos datos salen de get_material_order_reveal, y solo con el fee aprobado.
 */
async function revealFallbackRows(
  sb: ReturnType<typeof getSupabaseClient>,
  rows: ClientPickupOrderRow[],
): Promise<ClientPickupOrderRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const orderId = String(row.id ?? row.order_id ?? '').trim();
      if (!orderId) return row;
      const { data, error } = await sb.rpc('get_material_order_reveal', { p_order_id: orderId });
      if (error) return row;
      const reveal = (Array.isArray(data) ? data[0] : data) as OrderRevealRow | null;
      if (!reveal) return row;
      return applyOrderReveal(row, reveal);
    }),
  );
}

async function scopeRpcRowsToStore(
  sb: ReturnType<typeof getSupabaseClient>,
  rows: ClientPickupOrderRow[],
): Promise<ClientPickupOrderRow[]> {
  const ids = rows
    .filter((row) => !pickupItemsDeclareDecision(row))
    .map((row) => String(row.order_id ?? row.id ?? '').trim())
    .filter(Boolean);
  if (ids.length === 0) return rows;

  const { data, error } = await sb.from('orders').select(SELECT_STORE_QUOTES).in('id', ids);
  if (error || !Array.isArray(data)) return rows;
  return mergeStoreQuoteDetails(rows, data as ClientPickupOrderRow[]);
}

/**
 * Pedidos de materiales del cliente ya pagos: listos para retirar o ya retirados.
 * Prefiere la RPC existente. Cada tarjeta queda con los materiales aceptados
 * de esa cotización. Si no está, lee ítems de `request_items` / `quote_items`.
 * No usa el id de la solicitud en la tarjeta.
 */
export async function fetchClientMaterialPickups(): Promise<ClientPickupCardModel[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const rpc = await sb.rpc('list_my_material_solicitudes');
  if (!rpc.error && Array.isArray(rpc.data)) {
    const rpcRows = rowsFromRpc(rpc.data) ?? [];
    // Lista vacía: la RPC ya filtró. Si hay filas, exigimos `items` para el desplegable.
    if (rpcRows.length === 0 || rpcRows.some((row) => Array.isArray(row.items))) {
      return mapClientPickupOrders(await scopeRpcRowsToStore(sb, rpcRows));
    }
  }

  const paidFilter = 'status.eq.deposit_paid,status.eq.completed,deposit_status.eq.paid';
  const [ownRes, viaQuoteRes] = await Promise.all([
    sb.from('orders').select(SELECT_OWN).eq('client_id', user.id).or(paidFilter),
    sb
      .from('orders')
      .select(SELECT_BY_QUOTE_CLIENT)
      .eq('quotes.client_id', user.id)
      .or(paidFilter),
  ]);

  if (ownRes.error && viaQuoteRes.error) {
    const rpcMessage = rpc.error?.message;
    throw new Error(
      ownRes.error.message || viaQuoteRes.error.message || rpcMessage || 'No se pudieron cargar las solicitudes.',
    );
  }

  const byId = new Map<string, ClientPickupOrderRow>();
  for (const row of [...(ownRes.data ?? []), ...(viaQuoteRes.data ?? [])]) {
    const id = String((row as { id?: string }).id ?? '');
    if (!id) continue;
    byId.set(id, row as ClientPickupOrderRow);
  }

  return mapClientPickupOrders(await revealFallbackRows(sb, [...byId.values()]));
}
