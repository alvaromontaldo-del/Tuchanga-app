import { getSupabaseAnonKey, getSupabaseUrl } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import {
  INTRO_VIDEO_BUCKET,
  buildIntroVideoObjectPath,
  introVideoExtension,
  introVideoPlaybackUrl,
  isIntroVideoTooLarge,
  isSafeIntroVideoPath,
} from '../utils/introVideo';

type UploadProgress = (ratio: number) => void;

function storageObjectUrl(path: string): string {
  const encoded = path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${getSupabaseUrl()}/storage/v1/object/${INTRO_VIDEO_BUCKET}/${encoded}`;
}

async function accessToken(): Promise<string> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token?.trim();
  if (!token) throw new Error('Iniciá sesión para guardar el video.');
  return token;
}

function uploadErrorMessage(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 413 || lower.includes('payload') || lower.includes('too large') || lower.includes('maximum')) {
    return 'El video pesa más de 30 MB. Volvé a grabarlo, más corto.';
  }
  if (status === 415 || lower.includes('mime')) {
    return 'Solo se aceptan videos MP4 o MOV.';
  }
  if (lower.includes('intro_video') || lower.includes('schema') || lower.includes('function')) {
    return 'El video se subió, pero falta aplicar el SQL del video en Supabase.';
  }
  return 'No se pudo subir el video. Probá de nuevo.';
}

function uploadWithXhr(params: {
  url: string;
  fileUri: string;
  token: string;
  mime: string;
  onProgress?: UploadProgress;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', params.url);
    xhr.timeout = 180_000;
    xhr.setRequestHeader('Authorization', `Bearer ${params.token}`);
    xhr.setRequestHeader('apikey', getSupabaseAnonKey());
    xhr.setRequestHeader('Content-Type', params.mime);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        params.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText ?? '' });
    xhr.onerror = () => reject(new Error('No se pudo subir el video. Revisá tu conexión.'));
    xhr.ontimeout = () =>
      reject(new Error('La subida tardó demasiado. Probá de nuevo con mejor señal.'));
    const fileName = params.fileUri.split('/').pop()?.split('?')[0] || 'intro.mp4';
    // RN manda el archivo por URI (sin pasarlo por el fetch de 32 s de Supabase).
    xhr.send({
      uri: params.fileUri,
      type: params.mime,
      name: fileName,
    } as unknown as XMLHttpRequestBodyInit);
  });
}

/** Lectura aislada: si la columna todavía no existe, el perfil sigue cargando. */
export async function fetchIntroVideoPath(profileId: string): Promise<string | null> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('profiles')
      .select('intro_video_path')
      .eq('id', profileId)
      .maybeSingle();
    if (error || !data) return null;
    const path = (data as { intro_video_path?: string | null }).intro_video_path;
    return typeof path === 'string' && path.trim() ? path.trim() : null;
  } catch {
    return null;
  }
}

export function playbackUrlForPath(path: string | null | undefined): string | null {
  return introVideoPlaybackUrl(getSupabaseUrl(), path);
}

async function setMyIntroVideoPath(path: string | null): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc('set_my_intro_video_path', { p_path: path ?? '' });
  if (error) {
    const msg = error.message ?? '';
    if (/function|schema|set_my_intro_video_path|intro_video/i.test(msg)) {
      throw new Error('Falta aplicar el SQL del video en Supabase.');
    }
    throw new Error(msg || 'No se pudo guardar el video en el perfil.');
  }
}

async function removeStorageObject(path: string | null | undefined): Promise<void> {
  if (!isSafeIntroVideoPath(path)) return;
  const sb = getSupabaseClient();
  const { error } = await sb.storage.from(INTRO_VIDEO_BUCKET).remove([path!.trim()]);
  if (error) {
    console.warn('[intro-video] no se pudo borrar el archivo', error.message);
  }
}

export async function saveIntroVideoFromUri(params: {
  userId: string;
  localUri: string;
  mime: 'video/mp4' | 'video/quicktime';
  fileSize?: number | null;
  previousPath?: string | null;
  onProgress?: UploadProgress;
}): Promise<{ path: string; playbackUrl: string }> {
  if (isIntroVideoTooLarge(params.fileSize)) {
    throw new Error('El video pesa más de 30 MB. Volvé a grabarlo, más corto.');
  }

  const path = buildIntroVideoObjectPath(params.userId, introVideoExtension(params.mime));
  if (!isSafeIntroVideoPath(path)) {
    throw new Error('No se pudo armar la ruta del video.');
  }

  const token = await accessToken();
  const url = storageObjectUrl(path);
  params.onProgress?.(0);

  const uploaded = await uploadWithXhr({
    url,
    fileUri: params.localUri,
    token,
    mime: params.mime,
    onProgress: params.onProgress,
  });

  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(uploadErrorMessage(uploaded.status, uploaded.body));
  }

  try {
    await setMyIntroVideoPath(path);
  } catch (e) {
    await removeStorageObject(path);
    throw e;
  }

  if (params.previousPath && params.previousPath !== path) {
    await removeStorageObject(params.previousPath);
  }

  const playbackUrl = playbackUrlForPath(path);
  if (!playbackUrl) throw new Error('No se pudo armar el enlace del video.');
  return { path, playbackUrl };
}

export async function deleteIntroVideo(path: string | null | undefined): Promise<void> {
  await setMyIntroVideoPath(null);
  await removeStorageObject(path);
}
