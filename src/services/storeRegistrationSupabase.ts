import { getSupabaseClient } from '../lib/supabase';
import type { MyStoreSummary, StoreRubro } from '../types/materials';
import {
  normalizeStoreOpeningHours,
  validateStoreOpeningHours,
  type StoreHoursSlot,
} from '../utils/storeOpeningHours';

export type RegisterStoreInput = {
  name: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  /** @deprecated Ya no se usa en UI; BD mantiene default. */
  coverageRadiusKm?: number;
  rubroIds: string[];
  openingHours?: StoreHoursSlot[];
};

export type RegisteredStore = {
  id: string;
  name: string;
  status: string;
};

/**
 * Catálogo de rubros (comercios).
 */
export async function fetchStoreRubrosCatalog(): Promise<StoreRubro[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  const { data, error } = await sb.from('rubros').select('id, name').order('name', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? '').trim() || 'Rubro',
  }));
}

/**
 * Alta de comercio del usuario logueado → status pending_approval (default DB).
 */
export async function registerMyStore(input: RegisterStoreInput): Promise<RegisteredStore> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('Tenés que iniciar sesión.');

  const name = input.name.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();
  const rubroIds = Array.from(new Set(input.rubroIds.map((id) => id.trim()).filter(Boolean)));

  if (!name) throw new Error('Ingresá el nombre del comercio.');
  if (!address) throw new Error('Ingresá la dirección del local.');
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    throw new Error('Ubicá el local en el mapa o con GPS.');
  }
  if (rubroIds.length === 0) throw new Error('Seleccioná al menos un rubro.');

  const openingHours = normalizeStoreOpeningHours(input.openingHours ?? []);
  const hoursErr = validateStoreOpeningHours(openingHours);
  if (hoursErr) throw new Error(hoursErr);

  // Evitar altas duplicadas mientras hay una pendiente / activa.
  const existing = await fetchMyStoresDetailed();
  const blocking = existing.find((s) =>
    ['pending_approval', 'trial', 'active', 'unpaid'].includes(s.status),
  );
  if (blocking) {
    throw new Error(
      blocking.status === 'pending_approval'
        ? 'Ya tenés un comercio pendiente de aprobación.'
        : 'Ya tenés un comercio registrado con esta cuenta.',
    );
  }

  const { data: inserted, error: insertError } = await sb
    .from('stores')
    .insert({
      user_id: user.id,
      name,
      phone,
      address,
      latitude: input.latitude,
      longitude: input.longitude,
      // Columna legacy NOT NULL: default BD 10 km (ya no se edita en UI).
      coverage_radius_km:
        input.coverageRadiusKm != null &&
        Number.isFinite(input.coverageRadiusKm) &&
        input.coverageRadiusKm > 0
          ? Math.min(input.coverageRadiusKm, 500)
          : 10,
      status: 'pending_approval',
      trial_ends_at: null,
      opening_hours: openingHours,
    })
    .select('id, name, status')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || 'No se pudo crear el comercio.');
  }

  const storeId = String(inserted.id);
  const links = rubroIds.map((rubro_id) => ({ store_id: storeId, rubro_id }));
  const { error: linkError } = await sb.from('store_rubros').insert(links);

  if (linkError) {
    await sb.from('stores').delete().eq('id', storeId);
    throw new Error(linkError.message || 'No se pudieron asociar los rubros.');
  }

  return {
    id: storeId,
    name: String(inserted.name),
    status: String(inserted.status || 'pending_approval'),
  };
}

export async function fetchMyStoresDetailed(): Promise<MyStoreSummary[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const { data, error } = await sb
    .from('stores')
    .select('id, name, status')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.name as string) || 'Comercio',
    status: (r.status as string) || '',
    avatarUrl: null,
  }));
}

export function storeStatusLabel(status: string): string {
  switch (status) {
    case 'pending_approval':
      return 'Pendiente de aprobación';
    case 'trial':
      return 'Trial activo';
    case 'active':
      return 'Activo';
    case 'unpaid':
      return 'Pago pendiente';
    case 'paused':
      return 'Pausado';
    case 'rejected':
      return 'Rechazado';
    default:
      return status || 'Sin estado';
  }
}

export function storeCanReceiveQuotes(status: string): boolean {
  return status === 'trial' || status === 'active';
}

export type UpdateStoreInput = {
  storeId: string;
  name: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  rubroIds: string[];
  openingHours?: StoreHoursSlot[];
};

/**
 * Actualiza datos del comercio propio + rubros multi-select (`store_rubros`).
 */
export async function updateMyStore(input: UpdateStoreInput): Promise<void> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('Tenés que iniciar sesión.');

  const name = input.name.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();
  const rubroIds = Array.from(new Set(input.rubroIds.map((id) => id.trim()).filter(Boolean)));

  if (!name) throw new Error('Ingresá el nombre del comercio.');
  if (!address) throw new Error('Ingresá la dirección del local.');
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    throw new Error('Ubicá el local en el mapa o con GPS.');
  }
  if (rubroIds.length === 0) throw new Error('Seleccioná al menos un rubro.');

  const openingHours = normalizeStoreOpeningHours(input.openingHours ?? []);
  const hoursErr = validateStoreOpeningHours(openingHours);
  if (hoursErr) throw new Error(hoursErr);

  const { data: owned, error: ownErr } = await sb
    .from('stores')
    .select('id')
    .eq('id', input.storeId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (ownErr) throw ownErr;
  if (!owned) throw new Error('No podés editar este comercio.');

  const { error: upErr } = await sb
    .from('stores')
    .update({
      name,
      phone,
      address,
      latitude: input.latitude,
      longitude: input.longitude,
      opening_hours: openingHours,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.storeId)
    .eq('user_id', user.id);
  if (upErr) throw new Error(upErr.message || 'No se pudo actualizar el comercio.');

  const { error: delErr } = await sb.from('store_rubros').delete().eq('store_id', input.storeId);
  if (delErr) throw new Error(delErr.message || 'No se pudieron actualizar los rubros.');

  const links = rubroIds.map((rubro_id) => ({ store_id: input.storeId, rubro_id }));
  const { error: linkError } = await sb.from('store_rubros').insert(links);
  if (linkError) throw new Error(linkError.message || 'No se pudieron asociar los rubros.');
}

export async function fetchMyStoreRubroIds(storeId: string): Promise<string[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const { data, error } = await sb
    .from('store_rubros')
    .select('rubro_id')
    .eq('store_id', storeId);
  if (error) throw error;
  return (data ?? []).map((r) => String(r.rubro_id)).filter(Boolean);
}

export async function fetchMyStoreForEdit(storeId: string): Promise<{
  id: string;
  name: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
  rubroIds: string[];
  openingHours: StoreHoursSlot[];
} | null> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;

  const { data, error } = await sb
    .from('stores')
    .select('id, name, phone, address, latitude, longitude, opening_hours')
    .eq('id', storeId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const rubroIds = await fetchMyStoreRubroIds(storeId);
  return {
    id: String(data.id),
    name: String(data.name ?? ''),
    phone: String(data.phone ?? ''),
    address: String(data.address ?? ''),
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
    rubroIds,
    openingHours: normalizeStoreOpeningHours(
      (data as { opening_hours?: unknown }).opening_hours,
    ),
  };
}
