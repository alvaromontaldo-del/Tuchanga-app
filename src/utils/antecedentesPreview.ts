export type CertificatePreviewSource = {
  storagePath?: string | null;
  mimeType?: string | null;
};

/** La miniatura es solo de una foto. Un PDF no conserva la imagen anterior. */
export function shouldShowCertificateThumbnail(
  certificate: CertificatePreviewSource | null | undefined,
): boolean {
  const path = certificate?.storagePath?.trim() ?? '';
  if (!path) return false;
  return certificate?.mimeType !== 'application/pdf';
}

export type PreviewResolution = {
  token: number;
  activeToken: number;
  mounted: boolean;
  certificate: CertificatePreviewSource | null;
  signedUrl: string | null;
};

/**
 * `undefined`: la respuesta llegó tarde o el componente ya no está.
 * `null`: no hay miniatura (PDF, sin archivo, o se está cambiando).
 */
export function resolveCertificatePreview(input: PreviewResolution): string | null | undefined {
  if (!input.mounted || input.token !== input.activeToken) return undefined;
  if (!shouldShowCertificateThumbnail(input.certificate)) return null;
  return input.signedUrl;
}
