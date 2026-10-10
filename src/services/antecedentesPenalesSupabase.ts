import { File as ExpoFsFile } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { getSupabaseClient } from '../lib/supabase';
import {
  ANTECEDENTES_BUCKET,
  ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX,
  ANTECEDENTES_IMAGE_MAX_EDGE_PX,
  ANTECEDENTES_IMAGE_TARGET_BYTES,
  ANTECEDENTES_JPEG_QUALITIES,
  ANTECEDENTES_PDF_MAX_BYTES,
  antecedentesImageResize,
  antecedentesObjectName,
  antecedentesPdfRejected,
  parseMyAntecedentes,
  type MyAntecedentes,
} from '../utils/antecedentesPenales';

async function readUriBytes(uri: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('No se pudo leer el archivo.');
    return new Uint8Array(await res.arrayBuffer());
  }
  try {
    const file = new ExpoFsFile(uri);
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('No se pudo leer el archivo.');
    return new Uint8Array(await res.arrayBuffer());
  }
}

async function exportJpeg(
  uri: string,
  width: number,
  height: number,
  maxEdge: number,
  quality: number,
): Promise<{ uri: string; width: number; height: number }> {
  const resize = antecedentesImageResize(width, height, maxEdge);
  const out = await ImageManipulator.manipulateAsync(uri, resize ? [{ resize }] : [], {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return {
    uri: out.uri,
    width: Math.max(1, Math.floor(Number(out.width) || width)),
    height: Math.max(1, Math.floor(Number(out.height) || height)),
  };
}

/**
 * Foto del certificado: lado largo 1600 px y JPEG hasta quedar cerca de 350 KB,
 * sin bajar de calidad 0.34. Si sigue pesada, repite a 1200 px.
 */
export async function compressAntecedentesImage(uri: string): Promise<Uint8Array> {
  const meta = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  let working = meta.uri;
  let width = Math.max(1, Math.floor(Number(meta.width) || 1));
  let height = Math.max(1, Math.floor(Number(meta.height) || 1));
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();

  const edges = [ANTECEDENTES_IMAGE_MAX_EDGE_PX, ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX];
  for (const edge of edges) {
    for (const quality of ANTECEDENTES_JPEG_QUALITIES) {
      const out = await exportJpeg(working, width, height, edge, quality);
      working = out.uri;
      width = out.width;
      height = out.height;
      bytes = await readUriBytes(out.uri);
      if (bytes.byteLength > 0 && bytes.byteLength <= ANTECEDENTES_IMAGE_TARGET_BYTES) {
        return bytes;
      }
    }
  }

  if (!bytes.byteLength) throw new Error('La foto quedó vacía. Probá con otra.');
  if (bytes.byteLength > ANTECEDENTES_PDF_MAX_BYTES) {
    throw new Error('La foto sigue siendo muy pesada. Sacala de nuevo, más de cerca y con buena luz.');
  }
  return bytes;
}

/** Borra con la Storage API. Un fallo no deshace el envío: solo queda en el log. */
async function removeQuiet(path: string | null | undefined): Promise<void> {
  const name = (path ?? '').trim();
  if (!name) return;
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.storage.from(ANTECEDENTES_BUCKET).remove([name]);
    if (error) {
      console.warn('antecedentes: no se pudo borrar el archivo anterior', error.message);
    }
  } catch (err) {
    console.warn(
      'antecedentes: no se pudo borrar el archivo anterior',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function fetchMyAntecedentesPenales(): Promise<MyAntecedentes | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('get_my_antecedentes_penales');
  if (error) throw new Error(error.message);
  return parseMyAntecedentes(data);
}

export async function uploadMyAntecedentesPenales(input: {
  kind: 'image' | 'pdf';
  uri: string;
}): Promise<MyAntecedentes> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('Iniciá sesión para cargar el certificado.');

  let bytes: Uint8Array;
  let mime: string;
  let ext: 'jpg' | 'pdf';
  if (input.kind === 'pdf') {
    bytes = await readUriBytes(input.uri);
    const problem = antecedentesPdfRejected(bytes.byteLength);
    if (problem) throw new Error(problem);
    mime = 'application/pdf';
    ext = 'pdf';
  } else {
    bytes = await compressAntecedentesImage(input.uri);
    mime = 'image/jpeg';
    ext = 'jpg';
  }

  const path = `${user.id}/${antecedentesObjectName(ext)}`;
  const { error: uploadError } = await sb.storage.from(ANTECEDENTES_BUCKET).upload(path, bytes, {
    upsert: false,
    contentType: mime,
    cacheControl: '3600',
  });
  if (uploadError) {
    throw new Error(
      uploadError.message?.includes('row-level security')
        ? 'No se pudo subir el certificado (permisos de Storage).'
        : uploadError.message || 'No se pudo subir el certificado.',
    );
  }

  const { data, error } = await sb.rpc('submit_my_antecedentes_penales', {
    p_storage_path: path,
    p_mime_type: mime,
  });
  if (error) {
    await removeQuiet(path);
    throw new Error(error.message);
  }

  const previous =
    data && typeof data === 'object' && typeof (data as { previous_path?: unknown }).previous_path === 'string'
      ? (data as { previous_path: string }).previous_path
      : null;
  if (previous && previous !== path) await removeQuiet(previous);

  return (
    parseMyAntecedentes(data) ?? {
      status: 'pendiente',
      asunto: null,
      mimeType: mime,
      updatedAt: '',
    }
  );
}
