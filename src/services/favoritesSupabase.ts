import { getSupabaseClient } from '../lib/supabase';
import { professionalDisplayNameForClient } from '../utils/professionalDisplayName';
import { completedJobsFromPayload } from '../utils/workerReputation';

export type FavoriteProfessional = {
  id: string;
  firstName: string;
  summary: string;
  avatarUrl: string;
  ratingAverage: number;
  reviewCount: number;
  /**
   * Trabajos finalizados (`list_favorites.total_jobs_done`).
   * Ausente solo si el RPC no trae la columna.
   */
  totalJobsDone?: number;
  categories: string[];
};

type RpcFavoriteRow = {
  profile_id: string;
  nombre: string;
  avatar_url: string | null;
  primary_trade: string | null;
  all_trades: string[] | null;
  summary_jobs: string | null;
  rating_average?: number | string | null;
  review_count?: number | string | null;
  total_jobs_done?: number | string | null;
};

function finiteInRange(raw: unknown, max: number): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?u=favorite';

export async function toggleFavoriteInSupabase(params: {
  professionalId: string;
}): Promise<{ isFavorite: boolean }> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();
  const { data, error } = await sb.rpc('toggle_favorite', {
    p_professional_id: params.professionalId,
  });
  if (error) throw error;
  return { isFavorite: Boolean(data) };
}

export async function fetchFavoritesFromSupabase(): Promise<FavoriteProfessional[]> {
  const sb = getSupabaseClient();
  await sb.auth.getSession();

  const { data, error } = await sb.rpc('list_favorites');
  if (error) throw error;
  const rows = (data ?? []) as RpcFavoriteRow[];

  return rows.map((r) => {
    const firstName = professionalDisplayNameForClient(r.nombre);
    const categories = Array.isArray(r.all_trades) ? r.all_trades : [];
    const primary = r.primary_trade?.trim() || categories[0] || 'Servicios';
    const summary =
      r.summary_jobs?.trim() ||
      `${primary}${categories.length > 1 ? ` · ${categories.slice(1, 3).join(' · ')}` : ''}`;

    return {
      id: r.profile_id,
      firstName,
      summary,
      ratingAverage: finiteInRange(r.rating_average, 5),
      reviewCount: Math.floor(finiteInRange(r.review_count, Number.MAX_SAFE_INTEGER)),
      totalJobsDone: completedJobsFromPayload(r, 'total_jobs_done'),
      avatarUrl: r.avatar_url?.trim() || `${DEFAULT_AVATAR}&id=${encodeURIComponent(r.profile_id)}`,
      categories,
    };
  });
}

