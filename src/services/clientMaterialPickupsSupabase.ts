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
  completed_at,
  include_freight,
  contact_revealed_at
`;

const QUOTE_EMBED = `
  freight_type,
  stores ( name, address, opening_hours ),
  quote_items (
    id,
    client_decision,
    variant_label,
    alternative_description,
    in_stock,
    request_items ( description, quantity, unit )
  )
`;

const SELECT_OWN = `${ORDER_COLUMNS}, quotes ( ${QUOTE_EMBED} )`;
const SELECT_BY_QUOTE_CLIENT = `${ORDER_COLUMNS}, quotes!inner ( ${QUOTE_EMBED} )`;

/**
 * Pedidos de materiales del cliente ya pagos: listos para retirar o ya retirados.
 * No trae el id de la solicitud: la tarjeta no muestra N° de solicitud.
 */
export async function fetchClientMaterialPickups(): Promise<ClientPickupCardModel[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

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
    throw new Error(ownRes.error.message || 'No se pudieron cargar las solicitudes.');
  }

  const byId = new Map<string, ClientPickupOrderRow>();
  for (const row of [...(ownRes.data ?? []), ...(viaQuoteRes.data ?? [])]) {
    const id = String((row as { id?: string }).id ?? '');
    if (!id) continue;
    byId.set(id, row as ClientPickupOrderRow);
  }

  return mapClientPickupOrders([...byId.values()]);
}
