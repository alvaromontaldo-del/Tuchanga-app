import { getSupabaseClient } from '../lib/supabase';
import type { SearchWorkerHit, SearchableWorker } from '../data/mockSearchWorkers';

type RpcRow = {
  profile_id: string;
  nombre: string;
  apellido: string;
  avatar_url: string | null;
  lat: number;
  lng: number;
  coverage_km: number;
  distance_km: number;
  primary_trade: string | null;
  all_trades: string[] | null;
  summary_jobs: string | null;
  rating_average?: number | null;
  review_count?: number | null;
};

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?u=worker';

/**
 * Profesionales con al menos un job, ubicación y radio; el punto del cliente debe caer dentro del radio.
 */
export async function fetchSearchWorkerHitsFromSupabase(params: {
  clientLat: number;
  clientLng: number;
  query: string;
  categoryNames: string[];
  excludeUserId?: string;
}): Promise<SearchWorkerHit[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  const { data, error } = await sb.rpc('search_workers_for_client', {
    p_client_lat: params.clientLat,
    p_client_lng: params.clientLng,
    p_query: params.query.trim(),
    p_category_names:
      params.categoryNames.length > 0 ? params.categoryNames : null,
    p_exclude_user_id: params.excludeUserId ?? null,
    p_limit: 80,
  });

  if (error) throw error;
  const rows = (data ?? []) as RpcRow[];

  return rows.map((r) => {
    const firstName = r.nombre?.trim() || 'Profesional';
    const categories = Array.isArray(r.all_trades) ? r.all_trades : [];
    const primary = r.primary_trade?.trim() || categories[0] || 'Servicios';
    // Solo el oficio principal en la tarjeta de búsqueda (sin descripción larga).
    const summary = primary;

    const worker: SearchableWorker = {
      id: r.profile_id,
      firstName,
      summary,
      ratingAverage:
        typeof r.rating_average === 'number' && !Number.isNaN(r.rating_average)
          ? Math.max(0, Math.min(5, Number(r.rating_average) || 0))
          : 0,
      reviewCount:
        typeof r.review_count === 'number' && Number.isFinite(r.review_count)
          ? Math.max(0, Math.floor(Number(r.review_count) || 0))
          : 0,
      avatarUrl: r.avatar_url?.trim() || `${DEFAULT_AVATAR}&id=${encodeURIComponent(r.profile_id)}`,
      categories,
      lat: r.lat,
      lng: r.lng,
      coverageKm: Math.max(1, Math.floor(Number(r.coverage_km) || 1)),
    };

    return {
      worker,
      distanceKm: Math.max(0, Number(r.distance_km) || 0),
    };
  });
}
