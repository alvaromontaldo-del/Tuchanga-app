import { getSupabaseClient } from '../lib/supabase';
import {
  mapClientPickupOrders,
  type ClientPickupCardModel,
  type ClientPickupOrderRow,
} from '../utils/clientMaterialPickups';

const ORDER_SELECT = `
  id,
  order_code,
  status,
  deposit_status,
  accepted_total,
  verification_pin,
  created_at,
  completed_at,
  include_freight,
  contact_revealed_at,
  quotes (
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
  )
`;

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

  const [ownRes, viaQuoteRes] = await Promise.all([
    sb
      .from('orders')
      .select(ORDER_SELECT)
      .eq('client_id', user.id)
      .or('status.eq.deposit_paid,status.eq.completed,deposit_status.eq.paid'),
    sb
      .from('orders')
      .select(ORDER_SELECT.replace('quotes (', 'quotes!inner ('))
      .eq('quotes.client_id', user.id)
      .or('status.eq.deposit_paid,status.eq.completed,deposit_status.eq.paid'),
  ]);

  if (ownRes.error && viaQuoteRes.error) {
    throw ownRes.error;
  }

  const byId = new Map<string, ClientPickupOrderRow>();
  for (const row of [...(ownRes.data ?? []), ...(viaQuoteRes.data ?? [])]) {
    const id = String((row as { id?: string }).id ?? '');
    if (!id) continue;
    byId.set(id, row as ClientPickupOrderRow);
  }

  return mapClientPickupOrders([...byId.values()]);
}
