import { getSupabaseClient } from '../lib/supabase';

export type FavoriteProfessional = {
  id: string;
  firstName: string;
  summary: string;
  avatarUrl: string;
  ratingAverage: number;
  reviewCount: number;
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

  return rows.map((r) => {
    const firstName = r.nombre?.trim() || 'Profesional';
    const categories = Array.isArray(r.all_trades) ? r.all_trades : [];
    const primary = r.primary_trade?.trim() || categories[0] || 'Servicios';
    const summary =
      r.summary_jobs?.trim() ||
      `${primary}${categories.length > 1 ? ` · ${categories.slice(1, 3).join(' · ')}` : ''}`;

    return {
      id: r.profile_id,
      firstName,
      summary,
      ratingAverage: 0,
      reviewCount: 0,
      avatarUrl: r.avatar_url?.trim() || `${DEFAULT_AVATAR}&id=${encodeURIComponent(r.profile_id)}`,
      categories,
    };
  });
}

