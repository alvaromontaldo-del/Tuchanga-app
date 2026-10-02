/**
 * Dirección de entrega de un pedido de materiales.
 * Siempre es el domicilio del cliente del chat. Nunca el del profesional.
 */
export type JobClientDelivery = {
  clientId: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

function finiteCoord(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Acepta el domicilio solo si el id es el del cliente del trabajo
 * y no coincide con el profesional que arma el pedido.
 * Coordenadas 0,0 o una sola de las dos se descartan.
 * Sin texto ni punto usable, no hay dirección.
 */
export function pickJobClientDelivery(input: {
  professionalId: string;
  clientId: string | null | undefined;
  address: string | null | undefined;
  lat: number | null | undefined;
  lng: number | null | undefined;
}): JobClientDelivery | null {
  const professionalId = input.professionalId.trim();
  const clientId = (input.clientId ?? '').trim();
  if (!professionalId || !clientId || clientId === professionalId) return null;

  const address = (input.address ?? '').trim() || null;
  let lat = finiteCoord(input.lat);
  let lng = finiteCoord(input.lng);
  if (lat === 0 && lng === 0) {
    lat = null;
    lng = null;
  }
  if ((lat == null) !== (lng == null)) {
    lat = null;
    lng = null;
  }
  if (
    lat != null &&
    lng != null &&
    (lat < -90 || lat > 90 || lng < -180 || lng > 180)
  ) {
    lat = null;
    lng = null;
  }
  if (!address && lat == null) return null;
  return { clientId, address, lat, lng };
}

/** El RPC de dirección todavía no está en el proyecto (hay que ejecutar el SQL). */
export function isMissingDeliveryAddressRpc(error: {
  code?: string | null;
  message?: string | null;
} | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  if (code === 'PGRST202' || code === '42883') return true;
  return (
    msg.includes('could not find the function') ||
    msg.includes('get_conversation_client_delivery_address') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  );
}
