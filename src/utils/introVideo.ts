/** Tope de la tarjeta #18. El picker también corta en 30 s. */
export const INTRO_VIDEO_MAX_SECONDS = 30;

/** Límite del bucket `worker_videos` (30 MB). */
export const INTRO_VIDEO_MAX_BYTES = 30 * 1024 * 1024;

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
