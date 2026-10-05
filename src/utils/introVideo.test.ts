import { describe, expect, it } from 'vitest';
import {
  INTRO_VIDEO_MAX_BYTES,
  INTRO_VIDEO_MAX_LONG_SIDE,
  INTRO_VIDEO_RECORD_MAX_BYTES,
  INTRO_VIDEO_RECORD_QUALITY,
  INTRO_VIDEO_TARGET_VIDEO_BPS,
  formatIntroVideoSizeLabel,
  buildIntroVideoObjectPath,
  estimateIntroVideoBytes,
  introVideoDurationSeconds,
  introVideoHttpErrorMessage,
  introVideoMimeFromAsset,
  introVideoNetworkErrorMessage,
  introVideoObjectsToDelete,
  introVideoPlaybackUrl,
  introVideoRecordingOptions,
  introVideoTooLargeMessage,
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

  it('solo deja mp4 y quicktime, y rechaza archivos de más de 10 MB', () => {
    expect(introVideoMimeFromAsset({ mimeType: 'video/mp4', uri: 'file://a' })).toBe('video/mp4');
    expect(introVideoMimeFromAsset({ mimeType: 'video/quicktime', uri: 'file://a.mov' })).toBe(
      'video/quicktime',
    );
    expect(introVideoMimeFromAsset({ uri: 'file://clip.MOV' })).toBe('video/quicktime');
    expect(introVideoMimeFromAsset({ mimeType: 'video/webm', uri: 'file://a.webm' })).toBe(null);
    expect(INTRO_VIDEO_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(isIntroVideoTooLarge(INTRO_VIDEO_MAX_BYTES)).toBe(false);
    expect(isIntroVideoTooLarge(INTRO_VIDEO_MAX_BYTES + 1)).toBe(true);
    expect(introVideoTooLargeMessage(12 * 1024 * 1024)).toMatch(/12 MB/);
    expect(introVideoTooLargeMessage(12 * 1024 * 1024)).toMatch(/10 MB/);
    expect(introVideoTooLargeMessage(12 * 1024 * 1024)).toMatch(/comprimido/);
    expect(introVideoTooLargeMessage(12 * 1024 * 1024, 'picker')).toMatch(/cámara del sistema/);
    expect(formatIntroVideoSizeLabel(2.4 * 1024 * 1024)).toBe('Pesa 2.4 MB (máximo 10 MB).');
    expect(formatIntroVideoSizeLabel(null)).toMatch(/No se pudo medir/);
  });

  it('estima 30 s a 480p / 400 kbps por debajo de 3 MB y del tope de grabación', () => {
    expect(INTRO_VIDEO_RECORD_QUALITY).toBe('480p');
    expect(INTRO_VIDEO_MAX_LONG_SIDE).toBe(854);
    expect(INTRO_VIDEO_TARGET_VIDEO_BPS).toBe(400_000);
    const bytes = estimateIntroVideoBytes(30);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
    expect(bytes).toBeLessThan(INTRO_VIDEO_RECORD_MAX_BYTES);
    expect(INTRO_VIDEO_RECORD_MAX_BYTES).toBeLessThan(INTRO_VIDEO_MAX_BYTES);
    expect(estimateIntroVideoBytes(0)).toBe(0);
    expect(introVideoRecordingOptions('ios')).toEqual({
      maxDuration: 30,
      maxFileSize: INTRO_VIDEO_RECORD_MAX_BYTES,
      codec: 'avc1',
    });
    expect(introVideoRecordingOptions('android')).toEqual({
      maxDuration: 30,
      maxFileSize: INTRO_VIDEO_RECORD_MAX_BYTES,
    });
    expect(introVideoRecordingOptions('android').codec).toBeUndefined();
  });

  it('al reemplazar borra los intro viejos y deja el archivo nuevo', () => {
    const keep = `${UID}/intro-20.mp4`;
    expect(
      introVideoObjectsToDelete(
        ['intro-10.mp4', 'intro-20.mp4', 'avatar.jpg', '../intro-1.mp4', 'intro-3.mov'],
        UID,
        keep,
      ),
    ).toEqual([`${UID}/intro-10.mp4`, `${UID}/intro-3.mov`]);
  });

  it('el fallo de subir un file:// no se disfraza de problema de red', () => {
    expect(introVideoNetworkErrorMessage('')).toBe(
      'No se pudo subir el video. Revisá tu conexión.',
    );
    expect(introVideoNetworkErrorMessage('Network request failed')).toBe(
      'No se pudo subir el video. Revisá tu conexión.',
    );
    expect(
      introVideoNetworkErrorMessage('Could not retrieve file for uri file:///cache/intro.mp4'),
    ).toBe('No se pudo leer el video en el teléfono. Volvé a grabarlo.');
    expect(introVideoNetworkErrorMessage('Payload is set but no content-type header specified')).toBe(
      'No se pudo subir el video. Payload is set but no content-type header specified',
    );
    expect(introVideoHttpErrorMessage(413, 'Payload too large')).toMatch(/10 MB/);
    expect(introVideoHttpErrorMessage(403, 'new row violates row-level security policy')).toBe(
      'No se pudo subir el video (permisos de Storage).',
    );
    expect(introVideoHttpErrorMessage(400, 'Invalid key')).toBe(
      'No se pudo subir el video (error 400: Invalid key).',
    );
  });
});
