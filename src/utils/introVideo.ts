/** Tope de la tarjeta #18. La grabación también corta en 20 s. */
export const INTRO_VIDEO_MAX_SECONDS = 20;

/**
 * Red de seguridad del bucket `worker_videos` (10 MB).
 * La grabación apunta a 480p y 320 kbps: 20 s quedan en alrededor de 1 MB.
 */
export const INTRO_VIDEO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Tope que se le pasa a `recordAsync`, por debajo del bucket.
 * CameraX (Android) puede pasarse un poco de `maxFileSize`. 6 MB dejan margen
 * para que el archivo siga entrando en los 10 MB.
 * 20 s a 320 kbps no lo alcanzan (~1 MB). Si el teléfono ignora el bitrate,
 * corta acá en vez de armar un archivo que después se rechaza.
 */
export const INTRO_VIDEO_RECORD_MAX_BYTES = 6 * 1024 * 1024;

/** Lado largo máximo: 480p (854×480 en 16:9, 640×480 en el preset VGA de iOS). */
export const INTRO_VIDEO_MAX_LONG_SIDE = 854;

/**
 * Preview de la cámara en Android. Sin esto CameraX usa la resolución más alta
 * para la vista y la grabación se ve trabada. El video igual sale en `videoQuality`.
 */
export const INTRO_VIDEO_PREVIEW_SIZE = '640x480';

/**
 * Bits por segundo de video. 320 kbps en las dos plataformas.
 * Android: prop `videoBitrate` → CameraX `setTargetVideoEncodingBitRate`.
 * iOS: el mismo prop solo se aplica si `recordAsync` manda `codec: 'avc1'`.
 * Sin codec, iOS graba a bitrate alto y un clip corto se pasa de 10 MB.
 */
export const INTRO_VIDEO_TARGET_VIDEO_BPS = 320_000;

/**
 * Presupuesto de audio AAC. `expo-camera` no deja fijar el bitrate de audio
 * (suele quedar en 64–128 kbps). La estimación lo reserva igual.
 */
export const INTRO_VIDEO_TARGET_AUDIO_BPS = 128_000;

/**
 * `videoQuality` de expo-camera 17. Mismo valor en Android y iOS.
 * Android: CameraX `Quality.SD` (480p). Si el frente no lo tiene, el binario
 * sube de calidad; el bitrate igual limita el peso.
 * iOS: preset 640×480. No usar `4:3`: en iOS ese case cae en el preset `.high`.
 * El fallback de ImagePicker no comprime en Android (esos flags son de iOS).
 */
export const INTRO_VIDEO_RECORD_QUALITY = '480p' as const;

export const INTRO_VIDEO_BUCKET = 'worker_videos';

const PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/intro-[0-9]+\.(mp4|mov)$/i;

/**
 * `expo-image-picker` documenta `duration` en milisegundos.
 * Algunos Android devuelven segundos (un valor chico). Un take real nunca dura < 120 ms.
 */
export function introVideoDurationSeconds(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  if (raw <= 120) return raw;
  return raw / 1000;
}

export function isIntroVideoTooLong(rawDuration: number | null | undefined): boolean {
  const sec = introVideoDurationSeconds(rawDuration);
  if (sec == null) return false;
  return sec > INTRO_VIDEO_MAX_SECONDS + 1;
}

export function isIntroVideoTooLarge(bytes: number | null | undefined): boolean {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return false;
  return bytes > INTRO_VIDEO_MAX_BYTES;
}

/**
 * Varias APIs del teléfono miden el mismo archivo distinto
 * (`File.size`, `info().size`, `getInfoAsync`). La UI y el tope usan la mayor:
 * si una dice 4 MB y otra el tamaño real, no nos quedamos con la chica.
 */
export function pickIntroVideoByteSize(
  readings: readonly (number | null | undefined)[],
): number | null {
  let best: number | null = null;
  for (const raw of readings) {
    if (raw == null || !Number.isFinite(raw) || raw <= 0) continue;
    if (best == null || raw > best) best = raw;
  }
  return best;
}

/**
 * `File.arrayBuffer()` devuelve `bytes.buffer`. Esa memoria puede ser más
 * grande que el archivo (byteOffset o capacidad de más). Subir el buffer
 * entero hacía que la pantalla dijera ~4 MB y Storage viera más de 10 MB.
 * Lo que se valida y se sube es `byteLength` de la vista, nunca el buffer.
 */
export function introVideoViewByteLength(view: {
  byteLength: number;
  byteOffset?: number;
  bufferByteLength?: number | null;
} | null | undefined): number | null {
  if (!view || !Number.isFinite(view.byteLength) || view.byteLength <= 0) return null;
  return view.byteLength;
}

export function introVideoUploadProgress(raw: unknown): { sent: number; total: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { totalBytesSent?: unknown; totalBytesExpectedToSend?: unknown };
  const total = obj.totalBytesExpectedToSend;
  const sent = obj.totalBytesSent;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  const sentBytes = typeof sent === 'number' && Number.isFinite(sent) && sent >= 0 ? sent : 0;
  return { sent: sentBytes, total };
}

/** Si el archivo que va a salir a la red ya pasa el tope, devolver ese peso. */
export function introVideoUploadProgressTooLarge(raw: unknown): number | null {
  const progress = introVideoUploadProgress(raw);
  if (!progress || !isIntroVideoTooLarge(progress.total)) return null;
  return progress.total;
}

/** Tamaño esperado del archivo (video + audio) para no depender del encoder del test. */
export function estimateIntroVideoBytes(
  seconds: number,
  videoBps: number = INTRO_VIDEO_TARGET_VIDEO_BPS,
  audioBps: number = INTRO_VIDEO_TARGET_AUDIO_BPS,
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  if (!Number.isFinite(videoBps) || videoBps < 0) return 0;
  if (!Number.isFinite(audioBps) || audioBps < 0) return 0;
  return Math.ceil(((videoBps + audioBps) * seconds) / 8);
}

export function formatVideoMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (!Number.isFinite(mb) || mb < 0) return '0';
  if (mb >= 10) return mb.toFixed(0);
  const rounded = mb.toFixed(1);
  return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded;
}

export function formatIntroVideoSizeLabel(bytes: number | null | undefined): string {
  const maxLabel = formatVideoMegabytes(INTRO_VIDEO_MAX_BYTES);
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) {
    return `No se pudo medir el peso (máximo ${maxLabel} MB).`;
  }
  return `Pesa ${formatVideoMegabytes(bytes)} MB (máximo ${maxLabel} MB).`;
}

export function introVideoTooLargeMessage(
  bytes?: number | null,
  source: 'camera' | 'picker' = 'camera',
): string {
  const maxLabel = formatVideoMegabytes(INTRO_VIDEO_MAX_BYTES);
  const weight =
    bytes == null || !Number.isFinite(bytes) || bytes <= 0
      ? `El video pesa más de ${maxLabel} MB`
      : `El video pesa ${formatVideoMegabytes(bytes)} MB`;
  if (source === 'picker') {
    return `${weight} y el máximo es ${maxLabel} MB. La cámara del sistema no lo comprime. Volvé a grabarlo con la cámara de la app, más corto.`;
  }
  return `${weight} y el máximo es ${maxLabel} MB. Ya se grabó comprimido. Volvé a grabarlo, más corto.`;
}

const NETWORK_FAILURE_RE =
  /network request failed|failed to connect|unable to resolve host|internet connection|offline|socket|timed out|timeout|network error|the network connection was lost|conexi[oó]n/i;

const LOCAL_FILE_FAILURE_RE =
  /could not retrieve file|no such file|enoent|unable to open|nsurlerrordomain|not a file|file not found/i;

/**
 * `xhr.onerror` no trae status HTTP. El mensaje nativo distingue
 * «no pude leer el archivo» de un corte de red.
 */
export function introVideoNetworkErrorMessage(nativeMessage: string | null | undefined): string {
  const msg = (nativeMessage ?? '').replace(/\s+/g, ' ').trim();
  if (!msg || NETWORK_FAILURE_RE.test(msg)) {
    return 'No se pudo subir el video. Revisá tu conexión.';
  }
  if (LOCAL_FILE_FAILURE_RE.test(msg)) {
    return 'No se pudo leer el video en el teléfono. Volvé a grabarlo.';
  }
  return `No se pudo subir el video. ${msg.slice(0, 160)}`;
}

export function introVideoHttpErrorMessage(status: number, body: string): string {
  const lower = (body ?? '').toLowerCase();
  if (
    status === 413 ||
    lower.includes('payload') ||
    lower.includes('too large') ||
    lower.includes('maximum') ||
    lower.includes('exceeded')
  ) {
    return `El video pesa más de ${formatVideoMegabytes(INTRO_VIDEO_MAX_BYTES)} MB. Volvé a grabarlo, más corto.`;
  }
  if (status === 415 || lower.includes('mime')) {
    return 'Solo se aceptan videos MP4 o MOV.';
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('row-level security') ||
    lower.includes('unauthorized') ||
    lower.includes('permission') ||
    lower.includes('not authorized')
  ) {
    return 'No se pudo subir el video (permisos de Storage).';
  }
  if (lower.includes('intro_video') || lower.includes('schema') || lower.includes('function')) {
    return 'El video se subió, pero falta aplicar el SQL del video en Supabase.';
  }
  const detail = (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (detail) return `No se pudo subir el video (error ${status}: ${detail}).`;
  return `No se pudo subir el video (error ${status}).`;
}

/**
 * Opciones de `CameraView.recordAsync`.
 * iOS: `codec: 'avc1'` es obligatorio para que `videoBitrate` baje el peso.
 * Android: el codec no existe en la API; el bitrate va en la prop de la cámara.
 * `maxFileSize` es menor que el bucket para absorber el exceso de CameraX.
 */
export function introVideoRecordingOptions(platform: string): {
  maxDuration: number;
  maxFileSize: number;
  codec?: 'avc1';
} {
  const base = {
    maxDuration: INTRO_VIDEO_MAX_SECONDS,
    maxFileSize: INTRO_VIDEO_RECORD_MAX_BYTES,
  };
  if (platform === 'ios') return { ...base, codec: 'avc1' };
  return base;
}

/** Paths `intro-*` del dueño que hay que borrar al reemplazar, sin tocar el archivo nuevo. */
export function introVideoObjectsToDelete(
  fileNames: readonly string[],
  folder: string,
  keepPath: string,
): string[] {
  const prefix = folder.trim().toLowerCase();
  const keep = keepPath.trim();
  const stale: string[] = [];
  for (const raw of fileNames) {
    const name = raw.trim();
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) continue;
    const path = `${prefix}/${name}`;
    if (path === keep) continue;
    if (!isSafeIntroVideoPath(path)) continue;
    stale.push(path);
  }
  return stale;
}

export function isSafeIntroVideoPath(path: string | null | undefined): boolean {
  const value = (path ?? '').trim();
  if (!value || value.includes('..') || value.includes('\\')) return false;
  return PATH_RE.test(value);
}

export function introVideoExtension(mime: 'video/mp4' | 'video/quicktime'): 'mp4' | 'mov' {
  return mime === 'video/quicktime' ? 'mov' : 'mp4';
}

export function introVideoMimeFromAsset(asset: {
  mimeType?: string | null;
  uri?: string | null;
  fileName?: string | null;
}): 'video/mp4' | 'video/quicktime' | null {
  const mime = String(asset.mimeType ?? '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (mime === 'video/mp4' || mime === 'video/quicktime') return mime;
  const name = `${asset.fileName ?? ''} ${asset.uri ?? ''}`.toLowerCase();
  if (/\.mov(\?|$)/.test(name)) return 'video/quicktime';
  if (/\.(mp4|m4v)(\?|$)/.test(name)) return 'video/mp4';
  if (!mime) return 'video/mp4';
  return null;
}

export function buildIntroVideoObjectPath(
  userId: string,
  ext: 'mp4' | 'mov',
  nowMs: number = Date.now(),
): string {
  return `${userId.trim().toLowerCase()}/intro-${Math.floor(nowMs)}.${ext}`;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/** URL pública del bucket, mismo esquema que `avatars` (`getPublicUrl`). */
export function introVideoPlaybackUrl(
  supabaseUrl: string,
  stored: string | null | undefined,
): string | null {
  const base = supabaseUrl.trim().replace(/\/$/, '');
  const raw = (stored ?? '').trim();
  if (!base || !raw) return null;

  const prefix = `${base}/storage/v1/object/public/${INTRO_VIDEO_BUCKET}/`;
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    if (!raw.startsWith(prefix)) return null;
    path = decodeURIComponent(raw.slice(prefix.length).split('?')[0] ?? '');
  }
  if (!isSafeIntroVideoPath(path)) return null;
  return `${prefix}${encodePath(path)}`;
}

export function isLocalVideoUri(uri: string | null | undefined): boolean {
  const value = (uri ?? '').trim();
  return /^(file|content|ph|assets-library):/i.test(value);
}
