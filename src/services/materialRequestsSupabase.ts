import { getSupabaseClient } from '../lib/supabase';
import type { MaterialItemDraft, NearbyStore, StoreRubro } from '../types/materials';

/** Haversine en km con 1 decimal (alineado a `public.haversine_km` en SQL). */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/** Statuses que reciben solicitudes / cotizan (alineado a `store_is_eligible_for_quotes`). */
const ELIGIBLE_STORE_STATUSES = ['trial', 'active'] as const;

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  coverage_radius_km: number | string | null;
  status: string;
  store_rubros:
    | { rubro_id: string; rubros: { id: string; name: string } | { id: string; name: string }[] | null }[]
    | null;
};

function normalizeRubros(row: StoreRow): StoreRubro[] {
  const links = row.store_rubros ?? [];
  const out: StoreRubro[] = [];
  for (const link of links) {
    const r = link.rubros;
    if (!r) continue;
    const one = Array.isArray(r) ? r[0] : r;
    if (one?.id && one.name) out.push({ id: one.id, name: one.name });
  }
  return out;
}

function mapStoreRow(row: StoreRow, distanceKm?: number): NearbyStore {
  const coverage =
    typeof row.coverage_radius_km === 'number'
      ? row.coverage_radius_km
      : Number(row.coverage_radius_km) || 10;

  return {
    id: row.id,
    name: row.name,
    address: row.address?.trim() || '',
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    coverageRadiusKm: coverage,
    status: row.status,
    rubros: normalizeRubros(row),
    distanceKm: distanceKm ?? 0,
  };
}

async function fetchEligibleStoresRaw(): Promise<StoreRow[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  const { data, error } = await sb
    .from('stores')
    .select(
      `
      id,
      name,
      address,
      latitude,
      longitude,
      coverage_radius_km,
      status,
      store_rubros (
        rubro_id,
        rubros ( id, name )
      )
    `,
    )
    .in('status', [...ELIGIBLE_STORE_STATUSES]);

  if (error) throw error;
  return (data ?? []) as StoreRow[];
}

/**
 * Rubros que tienen al menos un comercio elegible (trial/active) en `stores` + `store_rubros`.
 * No usa el catálogo estático de oficios de trabajadores.
 */
export async function fetchRubrosWithActiveStores(): Promise<StoreRubro[]> {
  const rows = await fetchEligibleStoresRaw();
  const byId = new Map<string, StoreRubro>();
  for (const row of rows) {
    for (const r of normalizeRubros(row)) {
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  );
}

/**
 * Todos los comercios elegibles del rubro (sin filtro de distancia / radio / GPS).
 */
export async function fetchStoresByRubroId(rubroId: string): Promise<NearbyStore[]> {
  const id = rubroId.trim();
  if (!id) return [];

  const rows = await fetchEligibleStoresRaw();
  const mapped: NearbyStore[] = [];
  for (const row of rows) {
    const rubros = normalizeRubros(row);
    if (!rubros.some((r) => r.id === id)) continue;
    mapped.push(mapStoreRow(row));
  }
  mapped.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return mapped;
}

/**
 * @deprecated Preferir `fetchStoresByRubroId` (envío global por rubro, sin distancia).
 * Conservado por compatibilidad: ahora ignora radio/distancia y lista todos los elegibles.
 */
export async function fetchNearbyStores(_params: {
  clientLat: number;
  clientLng: number;
  maxDistanceKm?: number;
}): Promise<NearbyStore[]> {
  const rows = await fetchEligibleStoresRaw();
  return rows
    .map((row) => {
      let distanceKm = 0;
      if (
        row.latitude != null &&
        row.longitude != null &&
        Number.isFinite(_params.clientLat) &&
        Number.isFinite(_params.clientLng)
      ) {
        distanceKm = haversineKm(
          _params.clientLat,
          _params.clientLng,
          row.latitude,
          row.longitude,
        );
      }
      return mapStoreRow(row, distanceKm);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

export type CreateMaterialRequestInput = {
  professionalId: string;
  clientId?: string | null;
  clientLat?: number | null;
  clientLng?: number | null;
  /** Dirección de entrega (texto editable). */
  clientAddress?: string | null;
  conversationId?: string | null;
  title: string;
  items: MaterialItemDraft[];
  storeIds: string[];
  /** Rubro principal del pedido (requerido por schema). */
  rubroId: string;
};

export type CreateMaterialRequestResult = {
  requestId: string;
  storeCount: number;
};

/**
 * Crea material_request (status sent), ítems y targets en request_target_stores.
 */
export async function createMaterialRequestWithTargets(
  input: CreateMaterialRequestInput,
): Promise<CreateMaterialRequestResult> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  const title = input.title.trim();
  if (!title) throw new Error('Ingresá un título para la solicitud.');
  if (input.items.length === 0) throw new Error('Agregá al menos un ítem.');
  if (input.storeIds.length < 1) {
    throw new Error('No hay comercios del rubro para recibir la solicitud.');
  }
  if (!input.rubroId.trim()) {
    throw new Error('Seleccioná un rubro.');
  }

  const lat =
    typeof input.clientLat === 'number' && Number.isFinite(input.clientLat)
      ? input.clientLat
      : null;
  const lng =
    typeof input.clientLng === 'number' && Number.isFinite(input.clientLng)
      ? input.clientLng
      : null;
  if ((lat == null) !== (lng == null)) {
    throw new Error('La ubicación de entrega es inválida.');
  }

  const clientAddress = input.clientAddress?.trim() || null;

  const baseRow = {
    professional_id: input.professionalId,
    client_id: input.clientId ?? null,
    rubro_id: input.rubroId,
    title,
    status: 'sent' as const,
    client_lat: lat,
    client_lng: lng,
    conversation_id: input.conversationId?.trim() || null,
  };

  let request: { id: string } | null = null;
  let reqError: { message?: string } | null = null;

  {
    const first = await sb
      .from('material_requests')
      .insert({ ...baseRow, client_address: clientAddress })
      .select('id')
      .single();
    request = first.data as { id: string } | null;
    reqError = first.error;
    if (
      first.error &&
      /client_address|conversation_id|schema cache|column/i.test(first.error.message ?? '')
    ) {
      const { conversation_id: _c, ...withoutConv } = baseRow;
      const fallbackPayload: Record<string, unknown> = { ...withoutConv };
      if (!/client_address/i.test(first.error.message ?? '')) {
        fallbackPayload.client_address = clientAddress;
      }
      // Reintentos: sin conversation_id y/o sin client_address
      let fallback = await sb
        .from('material_requests')
        .insert(
          /client_address/i.test(first.error.message ?? '')
            ? withoutConv
            : { ...baseRow, client_address: clientAddress },
        )
        .select('id')
        .single();
      if (
        fallback.error &&
        /conversation_id|schema cache|column/i.test(fallback.error.message ?? '')
      ) {
        fallback = await sb
          .from('material_requests')
          .insert(
            /client_address/i.test(first.error.message + (fallback.error.message ?? ''))
              ? withoutConv
              : { ...withoutConv, client_address: clientAddress },
          )
          .select('id')
          .single();
      }
      request = fallback.data as { id: string } | null;
      reqError = fallback.error;
    }
  }

  if (reqError) throw reqError;
  if (!request?.id) throw new Error('No se pudo crear la solicitud.');
  const requestId = request.id;

  const itemRows = input.items.map((item, index) => ({
    request_id: requestId,
    description: item.description.trim(),
    // Compat schema: cantidad/UM viven en la descripción; el comercio cotiza un precio total.
    quantity: 1,
    unit: 'u',
    sort_order: index,
  }));

  const { error: itemsError } = await sb.from('request_items').insert(itemRows);
  if (itemsError) {
    await sb.from('material_requests').delete().eq('id', requestId);
    throw itemsError;
  }

  const targetRows = input.storeIds.map((storeId) => ({
    request_id: requestId,
    store_id: storeId,
    status: 'pending' as const,
  }));

  const { error: targetsError } = await sb.from('request_target_stores').insert(targetRows);
  if (targetsError) {
    await sb.from('material_requests').delete().eq('id', requestId);
    throw targetsError;
  }

  // Backup push (además del trigger + webhook de store_push_events).
  for (const storeId of input.storeIds) {
    void sb.functions
      .invoke('push_on_store_board', {
        body: {
          store_id: storeId,
          title: 'YaChanga',
          body: 'Tenés una nueva solicitud de cotización.',
          data: {
            type: 'store_board',
            column: 'nuevas',
            requestId,
            eventType: 'nueva_solicitud',
          },
        },
      })
      .catch(() => null);
  }

  return { requestId, storeCount: input.storeIds.length };
}

/** Primer rubro disponible (fallback legacy). */
export async function fetchFallbackRubroId(): Promise<string | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.from('rubros').select('id').order('name').limit(1).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
