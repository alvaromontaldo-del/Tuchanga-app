import { describe, expect, it } from 'vitest';
import {
  CHAT_IMAGE_REFRESH_SKEW_MS,
  CHAT_IMAGE_SIGNED_TTL_SEC,
  parseChatImageStorageRef,
  resolveChatImageUri,
  signedUrlNeedsRefresh,
  signedUrlRefreshDelayMs,
} from './chatImageStorage';

const LEGACY =
  'https://proj.supabase.co/storage/v1/object/public/job-photos/30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/1730000000000-ab.jpg';

describe('fotos de chat con URL firmada', () => {
  it('extrae el path viejo de job-photos para firmarlo cuando el bucket deja de ser público', () => {
    expect(parseChatImageStorageRef({ image_url: LEGACY })).toEqual({
      bucket: 'job-photos',
      path: '30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/1730000000000-ab.jpg',
    });
  });

  it('lee el path del bucket privado chat y de una URL firmada', () => {
    expect(
      parseChatImageStorageRef({
        image_bucket: 'chat',
        image_path: '30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/a.jpg',
      }),
    ).toEqual({
      bucket: 'chat',
      path: '30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/a.jpg',
    });

    expect(
      parseChatImageStorageRef({
        image_url:
          'https://proj.supabase.co/storage/v1/object/sign/chat/30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/a.jpg?token=abc',
      }),
    ).toEqual({
      bucket: 'chat',
      path: '30123456_montaldo/chat/11111111-1111-4111-8111-111111111111/a.jpg',
    });
  });

  it('muestra la URL firmada y no el https público, y conserva la foto local al enviar', () => {
    const signed = 'https://proj.supabase.co/storage/v1/object/sign/job-photos/a.jpg?token=new';
    expect(
      resolveChatImageUri({
        metadata: { image_url: LEGACY },
        signedUrl: signed,
      }),
    ).toBe(signed);

    expect(
      resolveChatImageUri({
        metadata: { image_url: 'file:///tmp/obra.jpg' },
        signedUrl: signed,
      }),
    ).toBe('file:///tmp/obra.jpg');
  });

  it('renueva la URL firmada al acercarse el vencimiento', () => {
    const now = 1_700_000_000_000;
    const expiresAt = now + CHAT_IMAGE_SIGNED_TTL_SEC * 1000;
    expect(signedUrlNeedsRefresh(expiresAt, now)).toBe(false);
    expect(signedUrlRefreshDelayMs(expiresAt, now)).toBe(
      CHAT_IMAGE_SIGNED_TTL_SEC * 1000 - CHAT_IMAGE_REFRESH_SKEW_MS,
    );
    expect(signedUrlNeedsRefresh(expiresAt, expiresAt - CHAT_IMAGE_REFRESH_SKEW_MS)).toBe(true);
    expect(signedUrlRefreshDelayMs(expiresAt, expiresAt)).toBe(0);
  });
});
