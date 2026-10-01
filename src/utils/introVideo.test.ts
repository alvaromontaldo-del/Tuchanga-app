import { describe, expect, it } from 'vitest';
import {
  INTRO_VIDEO_MAX_BYTES,
  buildIntroVideoObjectPath,
  introVideoDurationSeconds,
  introVideoMimeFromAsset,
  introVideoPlaybackUrl,
  isIntroVideoTooLarge,
  isIntroVideoTooLong,
  isSafeIntroVideoPath,
} from './introVideo';

const UID = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://kyxehrxcdealbujvvnxp.supabase.co';

describe('video de presentación', () => {
  it('acepta el path del dueño y rechaza traversal u otro bucket', () => {
    const path = buildIntroVideoObjectPath(UID, 'mp4', 1_700_000_000_000);
    expect(path).toBe(`${UID}/intro-1700000000000.mp4`);
    expect(isSafeIntroVideoPath(path)).toBe(true);
    expect(isSafeIntroVideoPath(`${UID}/intro-1.mov`)).toBe(true);
    expect(isSafeIntroVideoPath(`${UID}/../avatars/a.jpg`)).toBe(false);
    expect(isSafeIntroVideoPath('javascript:alert(1)')).toBe(false);
    expect(isSafeIntroVideoPath(`${UID}/apellido.mp4`)).toBe(false);
  });

  it('arma solo la URL pública del bucket worker_videos', () => {
    const path = `${UID}/intro-10.mp4`;
    expect(introVideoPlaybackUrl(BASE, path)).toBe(
      `${BASE}/storage/v1/object/public/worker_videos/${UID}/intro-10.mp4`,
    );
    expect(introVideoPlaybackUrl(BASE, `${BASE}/storage/v1/object/public/avatars/${UID}/a.jpg`)).toBe(
      null,
    );
    expect(introVideoPlaybackUrl(BASE, 'https://evil.example/video.mp4')).toBe(null);
    expect(introVideoPlaybackUrl(BASE, null)).toBe(null);
  });

  it('mide la duración en ms o en segundos y corta arriba de 31 s', () => {
    expect(introVideoDurationSeconds(30_000)).toBe(30);
    expect(introVideoDurationSeconds(30)).toBe(30);
    expect(isIntroVideoTooLong(30_000)).toBe(false);
    expect(isIntroVideoTooLong(31_500)).toBe(true);
    expect(isIntroVideoTooLong(45)).toBe(true);
    expect(isIntroVideoTooLong(null)).toBe(false);
  });

  it('solo deja mp4 y quicktime, y rechaza archivos de más de 30 MB', () => {
    expect(introVideoMimeFromAsset({ mimeType: 'video/mp4', uri: 'file://a' })).toBe('video/mp4');
    expect(introVideoMimeFromAsset({ mimeType: 'video/quicktime', uri: 'file://a.mov' })).toBe(
      'video/quicktime',
    );
    expect(introVideoMimeFromAsset({ uri: 'file://clip.MOV' })).toBe('video/quicktime');
    expect(introVideoMimeFromAsset({ mimeType: 'video/webm', uri: 'file://a.webm' })).toBe(null);
    expect(isIntroVideoTooLarge(INTRO_VIDEO_MAX_BYTES)).toBe(false);
    expect(isIntroVideoTooLarge(INTRO_VIDEO_MAX_BYTES + 1)).toBe(true);
  });
});
