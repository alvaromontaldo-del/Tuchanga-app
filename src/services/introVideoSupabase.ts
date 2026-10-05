import { File as ExpoFsFile, Paths } from 'expo-file-system';
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
  introVideoUploadProgress,
  introVideoUploadProgressTooLarge,
  introVideoViewByteLength,
  isIntroVideoTooLarge,
  isSafeIntroVideoPath,
  pickIntroVideoByteSize,
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

/**
 * El `File` que exporta el paquete no declara en el .d.ts todo lo que el
 * teléfono tiene (`copy`, `bytes`, `size`). Se leen igual que `info()`.
 */
type LocalFile = {
  uri: string;
  exists: boolean;
  size?: number | null;
  info?: () => { size?: number | null };
  open?: () => { size?: number | null; close?: () => void };
  copy: (destination: LocalFile) => void;
  delete: () => void;
  bytes: () => Promise<Uint8Array>;
};

function asLocalFile(file: ExpoFsFile): LocalFile {
  return file as unknown as LocalFile;
}

type LegacyFs = {
  cacheDirectory: string | null;
  copyAsync: (options: { from: string; to: string }) => Promise<void>;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; size?: number }>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  uploadAsync: (
    url: string,
    fileUri: string,
    options: LegacyUploadOptions,
  ) => Promise<{ status: number; body?: string }>;
  createUploadTask?: (
    url: string,
    fileUri: string,
    options: LegacyUploadOptions,
    callback?: (progress: unknown) => void,
  ) => {
    uploadAsync: () => Promise<{ status: number; body?: string } | undefined | null>;
    cancelAsync: () => Promise<void>;
  };
  FileSystemUploadType: { BINARY_CONTENT: number };
  FileSystemSessionType?: { FOREGROUND: number };
};

type LegacyUploadOptions = {
  httpMethod: 'POST';
  uploadType: number;
  sessionType?: number;
  headers: Record<string, string>;
};

const STAGED_NAME_RE = /intro-upload-\d+\.(mp4|mov)$/i;

function legacyFileSystem(): LegacyFs {
  // El módulo legacy ya está en el binario (expo-file-system). Sube el file://
  // sin pasar el video por un ArrayBuffer de JS.
  return require('expo-file-system/legacy') as LegacyFs;
}

function fileReadings(file: LocalFile): Array<number | null | undefined> {
  const readings: Array<number | null | undefined> = [file.size];
  try {
    readings.push(file.info?.().size);
  } catch {
    /* info() puede fallar en content:// */
  }
  try {
    const handle = file.open?.();
    readings.push(handle?.size);
    handle?.close?.();
  } catch {
    /* el handle es otra lectura, no es obligatoria */
  }
  return readings;
}

/**
 * El peso que se muestra es el de este archivo. Se queda con la lectura más
 * grande: en Android `info().size` a veces informa menos que `File.size`.
 */
export function measureLocalVideoFile(uri: string): number | null {
  try {
    return pickIntroVideoByteSize(fileReadings(asLocalFile(new ExpoFsFile(uri))));
  } catch {
    return null;
  }
}

async function measureFileBytes(uri: string, fallback?: number | null): Promise<number | null> {
  const readings: Array<number | null | undefined> = [measureLocalVideoFile(uri)];
  try {
    const info = await legacyFileSystem().getInfoAsync(uri);
    if (info.exists) readings.push(info.size);
  } catch {
    /* getInfoAsync en SDK 54 a veces devuelve size 0; las otras lecturas cubren */
  }
  // El fileSize del picker no pisa una medición del archivo: a veces miente.
  // Solo se usa si ninguna API pudo leer el file://.
  return pickIntroVideoByteSize(readings) ?? positiveSize(fallback);
}

function stagedExtension(uri: string): 'mp4' | 'mov' {
  return /\.mov(\?|$)/i.test(uri) ? 'mov' : 'mp4';
}

function isStagedIntroVideo(uri: string): boolean {
  return /^file:/i.test(uri) && STAGED_NAME_RE.test(uri.split('?')[0] ?? uri);
}

/**
 * Copia el video a un file:// propio y mide ESE archivo.
 * La cámara y el picker pueden devolver un content:// cuyo `info().size`
 * no es el archivo que después se lee. La copia nativa es el archivo que
 * se muestra, se valida y se sube.
 */
export async function stageIntroVideoFile(
  uri: string,
  fallbackSize?: number | null,
): Promise<{ uri: string; bytes: number; created: boolean }> {
  const source = uri.trim();
  if (!source) {
    throw new Error('No se pudo leer el video en el teléfono. Volvé a grabarlo.');
  }
  if (isStagedIntroVideo(source)) {
    const bytes = await measureFileBytes(source, fallbackSize);
    if (bytes == null) {
      throw new Error('No se pudo medir el peso del video. Volvé a grabarlo.');
    }
    return { uri: source, bytes, created: false };
  }

  const legacy = legacyFileSystem();
  const cache = legacy.cacheDirectory;
  if (!cache) {
    throw new Error('No se pudo preparar el video en el teléfono. Volvé a grabarlo.');
  }
  const name = `intro-upload-${Date.now()}.${stagedExtension(source)}`;
  const root = cache.endsWith('/') ? cache : `${cache}/`;
  let destUri = `${root}${name}`;
  try {
    const dest = asLocalFile(new ExpoFsFile(Paths.cache, name));
    asLocalFile(new ExpoFsFile(source)).copy(dest);
    destUri = dest.uri || destUri;
  } catch {
    await legacy.copyAsync({ from: source, to: destUri });
  }
  const bytes = await measureFileBytes(destUri, fallbackSize);
  if (bytes == null) {
    await deleteStagedIntroVideo(destUri);
    throw new Error('No se pudo medir el peso del video. Volvé a grabarlo.');
  }
  return { uri: destUri, bytes, created: true };
}

export async function deleteStagedIntroVideo(uri: string | null | undefined): Promise<void> {
  const value = (uri ?? '').trim();
  if (!isStagedIntroVideo(value)) return;
  try {
    const file = asLocalFile(new ExpoFsFile(value));
    if (file.exists) file.delete();
    return;
  } catch {
    /* legacy */
  }
  try {
    await legacyFileSystem().deleteAsync(value, { idempotent: true });
  } catch {
    /* el sistema limpia la caché */
  }
}

/**
 * Lee el video con `File.bytes()` (la vista), no con `arrayBuffer()`.
 * `arrayBuffer()` devuelve el buffer de atrás, que puede ser más grande
 * que el archivo. No usar xhr.send({ uri }): en RN 0.81 Android eso pasa
 * por ContentResolver, que no abre file://.
 */
async function readLocalVideoBytes(uri: string): Promise<Uint8Array> {
  try {
    const view = await asLocalFile(new ExpoFsFile(uri)).bytes();
    const length = introVideoViewByteLength({
      byteLength: view.byteLength,
      byteOffset: view.byteOffset,
      bufferByteLength: view.buffer?.byteLength,
    });
    if (length != null) {
      if (view.byteOffset === 0 && view.buffer.byteLength === view.byteLength) return view;
      return view.slice();
    }
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
    // Respaldo. La vista ya está recortada: no mandar `arrayBuffer()` entero,
    // porque el bridge lo pasa a base64 y el body puede pasar los 10 MB.
    xhr.send(params.bytes as unknown as XMLHttpRequestBodyInit);
  });
}

async function uploadFileWithNative(params: {
  url: string;
  fileUri: string;
  token: string;
  mime: string;
  source: 'camera' | 'picker';
  onProgress?: UploadProgress;
}): Promise<{ status: number; body: string }> {
  const legacy = legacyFileSystem();
  const options: LegacyUploadOptions = {
    httpMethod: 'POST',
    uploadType: legacy.FileSystemUploadType.BINARY_CONTENT,
    ...(legacy.FileSystemSessionType
      ? { sessionType: legacy.FileSystemSessionType.FOREGROUND }
      : {}),
    headers: {
      Authorization: `Bearer ${params.token}`,
      apikey: getSupabaseAnonKey(),
      'Content-Type': params.mime,
      'x-upsert': 'true',
    },
  };

  if (typeof legacy.createUploadTask !== 'function') {
    const uploaded = await legacy.uploadAsync(params.url, params.fileUri, options);
    return { status: uploaded.status, body: uploaded.body ?? '' };
  }

  let rejectedBytes: number | null = null;
  let sentBytes = 0;
  let task: {
    uploadAsync: () => Promise<{ status: number; body?: string } | undefined | null>;
    cancelAsync: () => Promise<void>;
  } | null = null;
  task = legacy.createUploadTask(params.url, params.fileUri, options, (raw) => {
    const tooLarge = introVideoUploadProgressTooLarge(raw);
    if (tooLarge != null) {
      rejectedBytes = tooLarge;
      void task?.cancelAsync();
      return;
    }
    const progress = introVideoUploadProgress(raw);
    if (progress) {
      if (progress.sent > 0) sentBytes = progress.sent;
      params.onProgress?.(progress.sent / progress.total);
    }
  });

  try {
    const uploaded = await task.uploadAsync();
    if (rejectedBytes != null) {
      throw new Error(introVideoTooLargeMessage(rejectedBytes, params.source));
    }
    if (!uploaded) throw new Error('No se pudo subir el video. Volvé a intentar.');
    return { status: uploaded.status, body: uploaded.body ?? '' };
  } catch (e) {
    if (rejectedBytes != null) {
      throw new Error(introVideoTooLargeMessage(rejectedBytes, params.source));
    }
    if (sentBytes > 0) {
      const msg = e instanceof Error ? e.message : '';
      throw new Error(introVideoNetworkErrorMessage(msg));
    }
    throw e;
  }
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
  const source = params.source ?? 'camera';
  const staged = await stageIntroVideoFile(params.localUri, params.fileSize);
  if (isIntroVideoTooLarge(staged.bytes)) {
    if (staged.created) await deleteStagedIntroVideo(staged.uri);
    throw new Error(introVideoTooLargeMessage(staged.bytes, source));
  }

  const path = buildIntroVideoObjectPath(params.userId, introVideoExtension(params.mime));
  if (!isSafeIntroVideoPath(path)) {
    throw new Error('No se pudo armar la ruta del video.');
  }

  const token = await accessToken();
  const url = storageObjectUrl(path);
  params.onProgress?.(0);

  let uploaded: { status: number; body: string };
  try {
    uploaded = await uploadFileWithNative({
      url,
      fileUri: staged.uri,
      token,
      mime: params.mime,
      source,
      onProgress: params.onProgress,
    });
  } catch (e) {
    if (e instanceof Error && /pesa|10 MB|Revisá tu conexión|tardó demasiado/.test(e.message)) {
      if (staged.created) await deleteStagedIntroVideo(staged.uri);
      throw e;
    }
    const bytes = await readLocalVideoBytes(staged.uri);
    if (isIntroVideoTooLarge(bytes.byteLength)) {
      if (staged.created) await deleteStagedIntroVideo(staged.uri);
      throw new Error(introVideoTooLargeMessage(bytes.byteLength, source));
    }
    uploaded = await uploadBytesWithXhr({
      url,
      bytes,
      token,
      mime: params.mime,
      onProgress: params.onProgress,
    });
  }

  if (staged.created) await deleteStagedIntroVideo(staged.uri);

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
