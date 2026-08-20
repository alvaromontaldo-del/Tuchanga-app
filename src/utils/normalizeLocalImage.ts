import * as ImageManipulator from 'expo-image-manipulator';

/** Mismo tope que oficios / publicaciones (`ImagePickerComponent`). */
export const LOCAL_IMAGE_MAX_WIDTH_PX = 1200;
/** Calidad JPEG compartida para no ocupar demasiado Storage. */
export const LOCAL_IMAGE_JPEG_COMPRESS = 0.7;

/**
 * Copia/normaliza un URI local (cámara o galería) a un JPEG en cache estable.
 * Redimensiona a máx. 1200px de ancho y comprime (mismo filtro que oficios/publicaciones).
 * En Android la URI de cámara suele ser temporal (`content://` / cache) y se invalida;
 * re-exportar con ImageManipulator evita preview rota y fallos al subir.
 */
export async function normalizeLocalImageUri(
  uri: string,
  opts?: { squareCrop?: boolean },
): Promise<string> {
  const raw = (uri ?? '').trim();
  if (!raw) throw new Error('URI de imagen vacío.');
  if (/^https?:\/\//i.test(raw)) return raw;

  const meta = await ImageManipulator.manipulateAsync(raw, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  let w = Math.max(1, Math.floor(Number(meta.width) || 1));
  let h = Math.max(1, Math.floor(Number(meta.height) || 1));
  let workingUri = meta.uri || raw;

  if (w > LOCAL_IMAGE_MAX_WIDTH_PX) {
    const resized = await ImageManipulator.manipulateAsync(
      workingUri,
      [{ resize: { width: LOCAL_IMAGE_MAX_WIDTH_PX } }],
      {
        compress: LOCAL_IMAGE_JPEG_COMPRESS,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );
    workingUri = resized.uri;
    w = Math.max(1, Math.floor(Number(resized.width) || LOCAL_IMAGE_MAX_WIDTH_PX));
    h = Math.max(
      1,
      Math.floor(Number(resized.height) || Math.round((h * LOCAL_IMAGE_MAX_WIDTH_PX) / w)),
    );
  } else {
    const exported = await ImageManipulator.manipulateAsync(workingUri, [], {
      compress: LOCAL_IMAGE_JPEG_COMPRESS,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    workingUri = exported.uri;
    w = Math.max(1, Math.floor(Number(exported.width) || w));
    h = Math.max(1, Math.floor(Number(exported.height) || h));
  }

  if (!opts?.squareCrop) return workingUri;

  const size = Math.min(w, h);
  const originX = Math.max(0, Math.floor((w - size) / 2));
  const originY = Math.max(0, Math.floor((h - size) / 2));
  const cropped = await ImageManipulator.manipulateAsync(
    workingUri,
    [{ crop: { originX, originY, width: size, height: size } }],
    {
      compress: LOCAL_IMAGE_JPEG_COMPRESS,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );
  return cropped.uri;
}
