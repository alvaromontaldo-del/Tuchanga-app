/**
 * Referencia estable de una foto de chat y cuándo renovar su URL firmada.
 * El bucket `chat` es privado. Las fotos viejas viven en `job-photos`.
 */

export const CHAT_IMAGE_BUCKET = 'chat';
export const LEGACY_CHAT_IMAGE_BUCKET = 'job-photos';
export const CHAT_IMAGE_SIGNED_TTL_SEC = 60 * 60;
export const CHAT_IMAGE_REFRESH_SKEW_MS = 60 * 1000;

export type ChatImageBucket = typeof CHAT_IMAGE_BUCKET | typeof LEGACY_CHAT_IMAGE_BUCKET;

export type ChatImageStorageRef = {
  bucket: ChatImageBucket;
  path: string;
};

const STORAGE_MARKERS: Array<{ marker: string; bucket: ChatImageBucket }> = [
  { marker: '/object/public/job-photos/', bucket: 'job-photos' },
  { marker: '/object/sign/job-photos/', bucket: 'job-photos' },
  { marker: '/object/authenticated/job-photos/', bucket: 'job-photos' },
  { marker: '/object/public/chat/', bucket: 'chat' },
  { marker: '/object/sign/chat/', bucket: 'chat' },
  { marker: '/object/authenticated/chat/', bucket: 'chat' },
];

export function isLocalImageUri(uri: string): boolean {
  return /^(file:|content:|blob:|data:|ph:|assets-library:)/i.test(uri.trim());
}

function cleanStorageUrl(url: string): string {
  return url.split('#')[0].split('?')[0].replace(/%2F/gi, '/');
}

export function parseStorageObjectUrl(url: string): ChatImageStorageRef | null {
  const clean = cleanStorageUrl(url.trim());
  if (!clean) return null;
  for (const { marker, bucket } of STORAGE_MARKERS) {
    const pos = clean.indexOf(marker);
    if (pos < 0) continue;
    let path = clean.slice(pos + marker.length).replace(/^\/+/, '');
    try {
      path = decodeURIComponent(path);
    } catch {
      // El path ya vino sin codificar.
    }
    if (!path || path.includes('..')) return null;
    return { bucket, path };
  }
  return null;
}

export function parseChatImageStorageRef(
  metadata: Record<string, unknown> | null | undefined,
): ChatImageStorageRef | null {
  if (!metadata) return null;
  const pathRaw = typeof metadata.image_path === 'string' ? metadata.image_path.trim() : '';
  if (pathRaw && !/^https?:/i.test(pathRaw) && !pathRaw.includes('..')) {
    const bucketRaw = typeof metadata.image_bucket === 'string' ? metadata.image_bucket.trim() : '';
    const bucket: ChatImageBucket = bucketRaw === 'job-photos' ? 'job-photos' : 'chat';
    return { bucket, path: pathRaw.replace(/^\/+/, '') };
  }
  const url = typeof metadata.image_url === 'string' ? metadata.image_url.trim() : '';
  if (!url || isLocalImageUri(url)) return null;
  return parseStorageObjectUrl(url);
}

/**
 * Prioridad: archivo local (optimistic), URL firmada vigente, y recién si
 * falló la firma el https público viejo.
 */
export function resolveChatImageUri(opts: {
  metadata?: Record<string, unknown> | null;
  signedUrl?: string | null;
  signFailed?: boolean;
}): string | null {
  const raw = typeof opts.metadata?.image_url === 'string' ? opts.metadata.image_url.trim() : '';
  if (raw && isLocalImageUri(raw)) return raw;
  const signed = opts.signedUrl?.trim() ?? '';
  if (signed) return signed;
  if (opts.signFailed && /^https?:\/\//i.test(raw)) return raw;
  return null;
}

export function signedUrlNeedsRefresh(
  expiresAtMs: number,
  nowMs: number,
  skewMs = CHAT_IMAGE_REFRESH_SKEW_MS,
): boolean {
  return nowMs >= expiresAtMs - skewMs;
}

export function signedUrlRefreshDelayMs(
  expiresAtMs: number,
  nowMs: number,
  skewMs = CHAT_IMAGE_REFRESH_SKEW_MS,
): number {
  const delay = expiresAtMs - skewMs - nowMs;
  return delay <= 0 ? 0 : delay;
}
