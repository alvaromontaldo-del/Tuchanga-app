import { describe, expect, it } from 'vitest';
import { certificateAfterUpload } from './antecedentesPenales';
import { resolveCertificatePreview, shouldShowCertificateThumbnail } from './antecedentesPreview';

function apply(input: {
  token: number;
  activeToken: number;
  mounted?: boolean;
  storagePath: string | null;
  mimeType: string | null;
  signedUrl: string | null;
}): string | null | undefined {
  return resolveCertificatePreview({
    token: input.token,
    activeToken: input.activeToken,
    mounted: input.mounted ?? true,
    certificate: { storagePath: input.storagePath, mimeType: input.mimeType },
    signedUrl: input.signedUrl,
  });
}

describe('vista previa del certificado', () => {
  it('la primera foto JPG usa el link firmado del archivo nuevo', () => {
    const uploaded = certificateAfterUpload(
      { status: 'pendiente', updated_at: '2026-11-05T12:00:00Z' },
      { storagePath: 'user/1730000000001-aaaaaa.jpg', mimeType: 'image/jpeg' },
    );
    expect(uploaded.storagePath).toBe('user/1730000000001-aaaaaa.jpg');
    expect(uploaded.mimeType).toBe('image/jpeg');
    expect(shouldShowCertificateThumbnail(uploaded)).toBe(true);
    expect(
      apply({
        token: 1,
        activeToken: 1,
        storagePath: uploaded.storagePath,
        mimeType: uploaded.mimeType,
        signedUrl: 'https://signed.example/primera.jpg',
      }),
    ).toBe('https://signed.example/primera.jpg');
  });

  it('reemplazar la foto descarta el link viejo y muestra la nueva', () => {
    const first = apply({
      token: 1,
      activeToken: 2,
      storagePath: 'user/1730000000001-aaaaaa.jpg',
      mimeType: 'image/jpeg',
      signedUrl: 'https://signed.example/vieja.jpg',
    });
    expect(first).toBeUndefined();

    const second = certificateAfterUpload(
      { status: 'pendiente' },
      { storagePath: 'user/1730000000002-bbbbbb.jpg', mimeType: 'image/jpeg' },
    );
    expect(
      apply({
        token: 2,
        activeToken: 2,
        storagePath: second.storagePath,
        mimeType: second.mimeType,
        signedUrl: 'https://signed.example/nueva.jpg',
      }),
    ).toBe('https://signed.example/nueva.jpg');
  });

  it('pasar de JPG a PDF no deja la miniatura anterior', () => {
    const pdf = certificateAfterUpload(
      { status: 'pendiente', previous_path: 'user/1730000000001-aaaaaa.jpg' },
      { storagePath: 'user/1730000000003-cccccc.pdf', mimeType: 'application/pdf' },
    );
    expect(pdf.mimeType).toBe('application/pdf');
    expect(pdf.storagePath).toBe('user/1730000000003-cccccc.pdf');
    expect(shouldShowCertificateThumbnail(pdf)).toBe(false);
    expect(
      apply({
        token: 3,
        activeToken: 3,
        storagePath: pdf.storagePath,
        mimeType: pdf.mimeType,
        signedUrl: 'https://signed.example/vieja.jpg',
      }),
    ).toBeNull();
  });

  it('ignora una firma que llega después de desmontar o de un envío más nuevo', () => {
    expect(
      apply({
        token: 1,
        activeToken: 1,
        mounted: false,
        storagePath: 'user/a.jpg',
        mimeType: 'image/jpeg',
        signedUrl: 'https://signed.example/tarde.jpg',
      }),
    ).toBeUndefined();
    expect(
      apply({
        token: 1,
        activeToken: 4,
        storagePath: 'user/a.jpg',
        mimeType: 'image/jpeg',
        signedUrl: 'https://signed.example/tarde.jpg',
      }),
    ).toBeUndefined();
  });
});
