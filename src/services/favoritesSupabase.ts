import { getSupabaseClient } from '../lib/supabase';
import { normalizeCompletedJobs } from '../utils/workerReputation';

export type FavoriteProfessional = {
  id: string;
  firstName: string;
  summary: string;
  avatarUrl: string;
  ratingAverage: number;
  reviewCount: number;
  /** Trabajos finalizados. Ausente si no se pudo leer el perfil. */
  totalJobsDone?: number;
  categories: string[];
};

type RpcFavoriteRow = {
  profile_id: string;
  nombre: string;
  apellido: string;
  avatar_url: string | null;
  primary_trade: string | null;
  all_trades: string[] | null;
  summary_jobs: string | null;
};

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

  const ids = rows.map((r) => String(r.profile_id ?? '').trim()).filter(Boolean);
  const stats = new Map<
    string,
    { ratingAverage: number; reviewCount: number; totalJobsDone: number }
  >();
  if (ids.length > 0) {
    const { data: profiles, error: pe } = await sb
      .from('profiles')
      .select('id,rating_average,review_count,total_jobs_done')
      .in('id', ids);
    if (!pe) {
      for (const p of (profiles ?? []) as {
        id?: string;
        rating_average?: number | null;
        review_count?: number | null;
        total_jobs_done?: unknown;
      }[]) {
        const id = String(p.id ?? '').trim();
        if (!id) continue;
        stats.set(id, {
          ratingAverage:
            typeof p.rating_average === 'number' && !Number.isNaN(p.rating_average)
              ? Math.max(0, Math.min(5, Number(p.rating_average) || 0))
              : 0,
          reviewCount:
            typeof p.review_count === 'number' && Number.isFinite(p.review_count)
              ? Math.max(0, Math.floor(Number(p.review_count) || 0))
              : 0,
          totalJobsDone: normalizeCompletedJobs(p.total_jobs_done),
        });
      }
    }
  }

  return rows.map((r) => {
    const firstName = r.nombre?.trim() || 'Profesional';
    const categories = Array.isArray(r.all_trades) ? r.all_trades : [];
    const primary = r.primary_trade?.trim() || categories[0] || 'Servicios';
    const summary =
      r.summary_jobs?.trim() ||
      `${primary}${categories.length > 1 ? ` · ${categories.slice(1, 3).join(' · ')}` : ''}`;

    const stat = stats.get(r.profile_id);
    return {
      id: r.profile_id,
      firstName,
      summary,
      ratingAverage: stat?.ratingAverage ?? 0,
      reviewCount: stat?.reviewCount ?? 0,
      totalJobsDone: stat?.totalJobsDone,
      avatarUrl: r.avatar_url?.trim() || `${DEFAULT_AVATAR}&id=${encodeURIComponent(r.profile_id)}`,
      categories,
    };
  });
}

