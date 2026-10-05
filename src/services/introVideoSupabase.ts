import { File as ExpoFsFile } from 'expo-file-system';
import { getSupabaseAnonKey, getSupabaseUrl } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import {
  INTRO_VIDEO_BUCKET,
  buildIntroVideoObjectPath,
  introVideoExtension,
  introVideoHttpErrorMessage,
  introVideoNetworkErrorMessage,
  introVideoObjectsToDelete,
  introVideoPlaybackUrl,
  introVideoTooLargeMessage,
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

function positiveSize(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** `File.size` no está en el tipo web del módulo; en el teléfono `info().size` sí. */
export function measureLocalVideoFile(uri: string): number | null {
  try {
    const file = new ExpoFsFile(uri) as ExpoFsFile & {
      info?: () => { size?: number | null };
    };
    return positiveSize(file.info?.().size);
  } catch {
    return null;
  }
}

/**
 * Lee el video con el File de expo-file-system (file:// y content://).
 * No usar xhr.send({ uri }): en RN 0.81 Android eso pasa por ContentResolver,
 * que no abre file:// y responde «Could not retrieve file for uri…» como
 * error de red. iOS trata esa URI como un request y también cae en onerror.
 * Un clip de 2 s fallaba igual que uno grande, con «revisá tu conexión».
 */
async function readLocalVideoBytes(uri: string): Promise<Uint8Array> {
  try {
    const bytes = new Uint8Array(await new ExpoFsFile(uri).arrayBuffer());
    if (bytes.byteLength > 0) return bytes;
  } catch {
    /* fetch de respaldo, mismo patrón que el avatar */
  }
  try {
    const res = await fetch(uri);
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 0) return bytes;
    }
  } catch {
    /* abajo */
  }
  throw new Error('No se pudo leer el video en el teléfono. Volvé a grabarlo.');
}

function uploadBytesWithXhr(params: {
  url: string;
  bytes: Uint8Array;
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
    xhr.onerror = () => {
      const native = typeof xhr.responseText === 'string' ? xhr.responseText : '';
      reject(new Error(introVideoNetworkErrorMessage(native)));
    };
    xhr.ontimeout = () =>
      reject(new Error('La subida tardó demasiado. Probá de nuevo con mejor señal.'));
    // Uint8Array → base64 en el bridge de RN y body binario con el Content-Type de arriba.
    xhr.send(params.bytes as unknown as XMLHttpRequestBodyInit);
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

/** Borra intros viejos de la carpeta del dueño. No toca `keepPath`. */
async function removeReplacedIntroVideos(keepPath: string, previousPath?: string | null): Promise<void> {
  if (previousPath && previousPath !== keepPath) {
    await removeStorageObject(previousPath);
  }
  const folder = keepPath.split('/')[0] ?? '';
  if (!folder) return;
  const sb = getSupabaseClient();
  const { data, error } = await sb.storage.from(INTRO_VIDEO_BUCKET).list(folder, { limit: 100 });
  if (error) {
    console.warn('[intro-video] no se pudo listar videos viejos', error.message);
    return;
  }
  const names = (data ?? [])
    .map((item) => item.name)
    .filter((name): name is string => typeof name === 'string');
  const stale = introVideoObjectsToDelete(names, folder, keepPath);
  if (stale.length === 0) return;
  const { error: rmErr } = await sb.storage.from(INTRO_VIDEO_BUCKET).remove(stale);
  if (rmErr) {
    console.warn('[intro-video] no se pudieron borrar videos viejos', rmErr.message);
  }
}

export async function saveIntroVideoFromUri(params: {
  userId: string;
  localUri: string;
  mime: 'video/mp4' | 'video/quicktime';
  fileSize?: number | null;
  source?: 'camera' | 'picker';
  previousPath?: string | null;
  onProgress?: UploadProgress;
}): Promise<{ path: string; playbackUrl: string }> {
  const knownSize = measureLocalVideoFile(params.localUri) ?? positiveSize(params.fileSize);
  if (isIntroVideoTooLarge(knownSize)) {
    throw new Error(introVideoTooLargeMessage(knownSize, params.source));
  }

  const path = buildIntroVideoObjectPath(params.userId, introVideoExtension(params.mime));
  if (!isSafeIntroVideoPath(path)) {
    throw new Error('No se pudo armar la ruta del video.');
  }

  const token = await accessToken();
  const url = storageObjectUrl(path);
  params.onProgress?.(0);
  const bytes = await readLocalVideoBytes(params.localUri);
  if (isIntroVideoTooLarge(bytes.byteLength)) {
    throw new Error(introVideoTooLargeMessage(bytes.byteLength, params.source));
  }

  const uploaded = await uploadBytesWithXhr({
    url,
    bytes,
    token,
    mime: params.mime,
    onProgress: params.onProgress,
  });

  if (uploaded.status === 0) {
    throw new Error(introVideoNetworkErrorMessage(uploaded.body));
  }
  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(introVideoHttpErrorMessage(uploaded.status, uploaded.body));
  }

  try {
    await setMyIntroVideoPath(path);
  } catch (e) {
    await removeStorageObject(path);
    throw e;
  }

  await removeReplacedIntroVideos(path, params.previousPath);

  const playbackUrl = playbackUrlForPath(path);
  if (!playbackUrl) throw new Error('No se pudo armar el enlace del video.');
  return { path, playbackUrl };
}

export async function deleteIntroVideo(path: string | null | undefined): Promise<void> {
  await setMyIntroVideoPath(null);
  await removeStorageObject(path);
}
