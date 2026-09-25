import { getSupabaseClient } from '../lib/supabase';
import {
  mapClientPickupOrders,
  type ClientPickupCardModel,
  type ClientPickupOrderRow,
} from '../utils/clientMaterialPickups';

const ORDER_COLUMNS = `
  id,
  order_code,
  status,
  deposit_status,
  accepted_total,
  verification_pin,
  created_at,
  updated_at,
  completed_at,
  include_freight,
  contact_revealed_at
`;

const QUOTE_EMBED = `
  freight_type,
  stores ( name, address, opening_hours ),
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

function rowsFromRpc(data: unknown): ClientPickupOrderRow[] | null {
  if (!Array.isArray(data)) return null;
  return data as ClientPickupOrderRow[];
}

/**
 * Pedidos de materiales del cliente ya pagos: listos para retirar o ya retirados.
 * Prefiere la RPC existente. Si no está, lee ítems de `request_items`.
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
      return mapClientPickupOrders(rpcRows);
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

  return mapClientPickupOrders([...byId.values()]);
}
