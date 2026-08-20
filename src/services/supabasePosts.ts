import { File as ExpoFsFile } from 'expo-file-system';
import { getSupabaseClient } from '../lib/supabase';
import { mapContentModerationError } from '../utils/contentModerationErrors';

function guessMime(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function readUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (/^https?:\/\//i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status}).`);
    return res.arrayBuffer();
  }
  try {
    const file = new ExpoFsFile(uri);
    return file.arrayBuffer();
  } catch {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('No se pudo leer la imagen (archivo local).');
    return res.arrayBuffer();
  }
}

async function uploadPostImage(params: {
  ownerFolder: string;
  postId: string;
  index: number;
  uri: string;
}): Promise<string> {
  const supabase = getSupabaseClient();
  const mime = guessMime(params.uri);
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = `${params.ownerFolder}/posts/${params.postId}/${params.index}.${ext}`;
  const buf = await readUriAsArrayBuffer(params.uri);

  const { error } = await supabase.storage.from('job-photos').upload(path, new Uint8Array(buf), {
    upsert: true,
    contentType: mime,
  });
  if (error) throw error;

  const { data } = supabase.storage.from('job-photos').getPublicUrl(path);
  return data.publicUrl;
}

export async function createPostInSupabase(params: {
  trade: string;
  description: string;
  imageUris: string[];
}): Promise<{ postId: string; imageUrls: string[]; createdAt: string }> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: ue,
  } = await supabase.auth.getUser();
  if (ue || !user?.id) throw new Error('No hay sesión activa.');

  // Crear fila primero para tener postId estable.
  const { data: inserted, error: ie } = await supabase
    .from('posts')
    .insert({
      worker_id: user.id,
      trade: params.trade.trim(),
      description: params.description.trim(),
      image_urls: [],
    })
    .select('id,created_at')
    .single();
  if (ie) throw new Error(mapContentModerationError(ie));

  const postId = String((inserted as { id: string }).id);
  const createdAt = String((inserted as { created_at: string }).created_at);

  // Carpeta UUID: compatible con RLS de Storage (también acepta dni_apellido vía RPC).
  const ownerFolder = user.id;

  const imageUrls: string[] = [];
  for (let i = 0; i < Math.min(params.imageUris.length, 3); i++) {
    const uri = params.imageUris[i];
    if (!uri) continue;
    try {
      const url = await uploadPostImage({ ownerFolder, postId, index: i, uri });
      imageUrls.push(url);
    } catch (e) {
      console.warn('[createPostInSupabase] foto omitida:', e);
    }
  }

  if (params.imageUris.length > 0 && imageUrls.length === 0) {
    throw new Error(
      'No se pudieron subir las fotos. Revisá permisos de Storage (job-photos) o probá de nuevo.',
    );
  }

  const { error: ue2 } = await supabase
    .from('posts')
    .update({ image_urls: imageUrls })
    .eq('id', postId);
  if (ue2) throw ue2;

  return { postId, imageUrls, createdAt };
}

type PostRow = {
  id: string;
  worker_id: string;
  trade: string;
  description: string;
  image_urls: string[] | null;
  created_at: string;
  profiles?: {
    nombre?: string | null;
    avatar_url?: string | null;
    rating_average?: number | null;
    review_count?: number | null;
  } | null;
};

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?u=worker';

type PostFeedRow = {
  id: string;
  worker_id: string;
  trade: string;
  description: string;
  image_urls: string[] | null;
  created_at: string;
  worker_nombre: string | null;
  worker_avatar_url: string | null;
  worker_rating_average?: number | null;
  worker_review_count?: number | null;
  like_count?: number | null;
  liked_by_me?: boolean | null;
};

function mapPostFeedRow(x: PostFeedRow) {
  const fullName = (x.worker_nombre ?? '').trim() || 'Profesional';
  const firstName = fullName.split(' ')[0] || fullName;
  const urls = Array.isArray(x.image_urls) ? x.image_urls : [];
  return {
    id: x.id,
    workerId: x.worker_id,
    workerFirstName: firstName,
    workerAvatarUrl:
      (x.worker_avatar_url ?? '').trim() ||
      `${DEFAULT_AVATAR}&id=${encodeURIComponent(x.worker_id)}`,
    workerRatingAverage:
      typeof x.worker_rating_average === 'number'
        ? Number(x.worker_rating_average) || 0
        : undefined,
    workerReviewCount:
      typeof x.worker_review_count === 'number'
        ? Math.max(0, Math.floor(Number(x.worker_review_count) || 0))
        : undefined,
    trade: (x.trade ?? '').trim() || 'Servicios',
    workImageUrls: urls.filter(Boolean),
    description: (x.description ?? '').trim(),
    createdAt: x.created_at,
    likeCount: Math.max(0, Number(x.like_count ?? 0) || 0),
    likedByMe: Boolean(x.liked_by_me),
  };
}

export async function togglePostLikeInSupabase(
  postId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('toggle_post_like', { p_post_id: postId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    liked?: boolean;
    like_count?: number;
  } | null;
  return {
    liked: Boolean(row?.liked),
    likeCount: Math.max(0, Number(row?.like_count ?? 0) || 0),
  };
}

export async function fetchFeedPostsFromSupabase(params?: {
  limit?: number;
}): Promise<
  Array<{
    id: string;
    workerId: string;
    workerFirstName: string;
    workerAvatarUrl: string;
    workerRatingAverage?: number;
    workerReviewCount?: number;
    trade: string;
    workImageUrls: string[];
    description: string;
    createdAt: string;
    likeCount: number;
    likedByMe: boolean;
  }>
> {
  const supabase = getSupabaseClient();
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 100));

  // Preferimos el feed filtrado desde BD (excluye publicaciones ocultas para auth.uid()).
  type RpcRow = PostFeedRow;

  const rpc = await supabase.rpc('fetch_feed_posts', { p_limit: limit });
  if (!rpc.error) {
    return ((rpc.data ?? []) as PostFeedRow[]).map(mapPostFeedRow);
  } else {
    // Fallback compat: si la RPC no existe todavía, usamos el select legacy (sin filtro server-side).
    const msg = (rpc.error.message ?? '').toLowerCase();
    if (!msg.includes('fetch_feed_posts')) throw rpc.error;
    const { data, error } = await supabase
      .from('posts')
      .select('id,worker_id,trade,description,image_urls,created_at,profiles(nombre,avatar_url,rating_average,review_count,coverage_km)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as Array<
      PostRow & { profiles?: (PostRow['profiles'] & { coverage_km?: number | null }) | null }
    >;

    return rows.map((r) => ({
      ...mapPostFeedRow({
        id: r.id,
        worker_id: r.worker_id,
        trade: r.trade,
        description: r.description,
        image_urls: r.image_urls,
        created_at: r.created_at,
        worker_nombre: r.profiles?.nombre ?? null,
        worker_avatar_url: r.profiles?.avatar_url ?? null,
        worker_rating_average: r.profiles?.rating_average ?? null,
        worker_review_count: r.profiles?.review_count ?? null,
        like_count: 0,
        liked_by_me: false,
      }),
    }));
  }
}

/** Publicaciones de un trabajador (perfil); mismo shape que el feed sin likes persistidos. */
export async function fetchPostsByWorkerIdFromSupabase(
  workerId: string,
  params?: { limit?: number },
): Promise<
  Array<{
    id: string;
    workerId: string;
    workerFirstName: string;
    workerAvatarUrl: string;
    workerRatingAverage?: number;
    trade: string;
    workImageUrls: string[];
    description: string;
    createdAt: string;
    likeCount: number;
    likedByMe: boolean;
  }>
> {
  const supabase = getSupabaseClient();
  const limit = Math.max(1, Math.min(params?.limit ?? 40, 100));

  const rpc = await supabase.rpc('fetch_worker_posts', { p_worker_id: workerId, p_limit: limit });
  if (!rpc.error) {
    return ((rpc.data ?? []) as PostFeedRow[]).map(mapPostFeedRow);
  } else {
    const msg = (rpc.error.message ?? '').toLowerCase();
    if (!msg.includes('fetch_worker_posts')) throw rpc.error;
  }

  const { data, error } = await supabase
    .from('posts')
    .select('id,worker_id,trade,description,image_urls,created_at,profiles(nombre,avatar_url,rating_average,review_count,coverage_km)')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  // Fallback: excluir ocultas para el viewer actual (la RPC ya lo hace server-side).
  let hiddenIds = new Set<string>();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      const ids = ((data ?? []) as PostRow[]).map((r) => r.id);
      if (ids.length) {
        const { data: hidden } = await supabase
          .from('publicaciones_ocultas')
          .select('publicacion_id')
          .eq('user_id', user.id)
          .in('publicacion_id', ids);
        hiddenIds = new Set(
          ((hidden ?? []) as { publicacion_id: string }[]).map((h) => String(h.publicacion_id)),
        );
      }
    }
  } catch {
    /* ignore */
  }

  const rows = ((data ?? []) as PostRow[]).filter((r) => !hiddenIds.has(r.id));
  return rows.map((r) =>
    mapPostFeedRow({
      id: r.id,
      worker_id: r.worker_id,
      trade: r.trade,
      description: r.description,
      image_urls: r.image_urls,
      created_at: r.created_at,
      worker_nombre: r.profiles?.nombre ?? null,
      worker_avatar_url: r.profiles?.avatar_url ?? null,
      worker_rating_average: r.profiles?.rating_average ?? null,
      worker_review_count: r.profiles?.review_count ?? null,
      like_count: 0,
      liked_by_me: false,
    }),
  );
}

export async function deletePostInSupabase(postId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('No hay sesión activa.');

  const { error } = await supabase.from('posts').delete().eq('id', postId).eq('worker_id', user.id);
  if (error) throw error;
}

export async function hidePostInSupabase(postId: string): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.auth.getSession();
  const { error } = await supabase.rpc('hide_post', { p_publicacion_id: postId });
  if (error) throw error;
}

/** Una publicación por id (detalle). Devuelve null si no existe u ocultada para el viewer. */
export async function fetchPostByIdFromSupabase(postId: string): Promise<{
  id: string;
  workerId: string;
  workerFirstName: string;
  workerAvatarUrl: string;
  workerRatingAverage?: number;
  trade: string;
  workImageUrls: string[];
  description: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
} | null> {
  const supabase = getSupabaseClient();
  const id = (postId ?? '').trim();
  if (!id) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.id) {
    const { data: hidden } = await supabase
      .from('publicaciones_ocultas')
      .select('publicacion_id')
      .eq('user_id', user.id)
      .eq('publicacion_id', id)
      .maybeSingle();
    if (hidden) return null;
  }

  const { data, error } = await supabase
    .from('posts')
    .select(
      'id,worker_id,trade,description,image_urls,created_at,profiles(nombre,avatar_url,rating_average,review_count)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const r = data as PostRow;
  return mapPostFeedRow({
    id: r.id,
    worker_id: r.worker_id,
    trade: r.trade,
    description: r.description,
    image_urls: r.image_urls,
    created_at: r.created_at,
    worker_nombre: r.profiles?.nombre ?? null,
    worker_avatar_url: r.profiles?.avatar_url ?? null,
    worker_rating_average: r.profiles?.rating_average ?? null,
    worker_review_count: r.profiles?.review_count ?? null,
    like_count: 0,
    liked_by_me: false,
  });
}


