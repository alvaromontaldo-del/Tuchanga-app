import { File as ExpoFsFile } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { getSupabaseClient } from '../lib/supabase';
import {
  MATRICULA_BUCKET,
  MATRICULA_IMAGE_FALLBACK_EDGE_PX,
  MATRICULA_IMAGE_MAX_EDGE_PX,
  MATRICULA_IMAGE_TARGET_BYTES,
  MATRICULA_JPEG_QUALITIES,
  MATRICULA_PHOTO_MAX_BYTES,
  MATRICULA_SIGNED_URL_TTL_SEC,
  matriculaImageResize,
  matriculaObjectName,
  parseMyMatriculas,
  type MatriculaOficioCodigo,
  type MyMatriculasBundle,
} from '../utils/matriculaVerificada';

async function readUriBytes(uri: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('No se pudo leer la foto.');
    return new Uint8Array(await res.arrayBuffer());
  }
  try {
    const file = new ExpoFsFile(uri);
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('No se pudo leer la foto.');
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
  const resize = matriculaImageResize(width, height, maxEdge);
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
 * Foto de la matrícula: lado largo 1600 px y JPEG hasta quedar cerca de 350 KB,
 * sin bajar de calidad 0.34. Si sigue pesada, repite a 1200 px.
 */
export async function compressMatriculaImage(uri: string): Promise<Uint8Array> {
  const meta = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  let working = meta.uri;
  let width = Math.max(1, Math.floor(Number(meta.width) || 1));
  let height = Math.max(1, Math.floor(Number(meta.height) || 1));
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();

  const edges = [MATRICULA_IMAGE_MAX_EDGE_PX, MATRICULA_IMAGE_FALLBACK_EDGE_PX];
  for (const edge of edges) {
    for (const quality of MATRICULA_JPEG_QUALITIES) {
      const out = await exportJpeg(working, width, height, edge, quality);
      working = out.uri;
      width = out.width;
      height = out.height;
      bytes = await readUriBytes(out.uri);
      if (bytes.byteLength > 0 && bytes.byteLength <= MATRICULA_IMAGE_TARGET_BYTES) {
        return bytes;
      }
    }
  }

  if (!bytes.byteLength) throw new Error('La foto quedó vacía. Probá con otra.');
  if (bytes.byteLength > MATRICULA_PHOTO_MAX_BYTES) {
    throw new Error('La foto sigue siendo muy pesada. Sacala de nuevo, más de cerca y con buena luz.');
  }
  return bytes;
}

/** Borra con la Storage API. Un fallo no deshace el envío: solo queda en el log. */
async function removeQuiet(paths: string[]): Promise<void> {
  const names = paths.map((path) => path.trim()).filter(Boolean);
  if (!names.length) return;
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.storage.from(MATRICULA_BUCKET).remove(names);
    if (error) {
      console.warn('matricula: no se pudo borrar la foto anterior', error.message);
    }
  } catch (err) {
    console.warn(
      'matricula: no se pudo borrar la foto anterior',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function signedMatriculaUrl(path: string): Promise<string | null> {
  const name = path.trim();
  if (!name) return null;
  const sb = getSupabaseClient();
  const { data, error } = await sb.storage
    .from(MATRICULA_BUCKET)
    .createSignedUrl(name, MATRICULA_SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function fetchMyMatriculas(): Promise<MyMatriculasBundle> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('get_my_matriculas');
  if (error) throw new Error(error.message);
  return parseMyMatriculas(data);
}

/**
 * Suma fotos y datos de un oficio. No llama a `submit_my_matricula`:
 * esa RPC vieja sigue reemplazando solo el legado, para la app ya publicada.
 */
export async function uploadMyMatriculaOficio(input: {
  oficio: MatriculaOficioCodigo;
  numero: string;
  entidad: string;
  uris: string[];
}): Promise<void> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('Iniciá sesión para cargar la matrícula.');

  const uploaded: string[] = [];
  try {
    for (const uri of input.uris) {
      const bytes = await compressMatriculaImage(uri);
      const path = `${user.id}/${matriculaObjectName()}`;
      const { error: uploadError } = await sb.storage.from(MATRICULA_BUCKET).upload(path, bytes, {
        upsert: false,
        contentType: 'image/jpeg',
        cacheControl: '3600',
      });
      if (uploadError) {
        throw new Error(
          uploadError.message?.includes('row-level security')
            ? 'No se pudo subir la foto (permisos de Storage).'
            : uploadError.message || 'No se pudo subir la foto.',
        );
      }
      uploaded.push(path);
    }

    const { error } = await sb.rpc('submit_my_matricula_oficio', {
      p_oficio: input.oficio,
      p_numero: input.numero.trim(),
      p_entidad: input.entidad.trim(),
      p_storage_paths: uploaded,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    await removeQuiet(uploaded);
    throw err;
  }
}

export async function deleteMyMatriculaFoto(fotoId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc('delete_my_matricula_foto', { p_foto_id: fotoId });
  if (error) throw new Error(error.message);
  const path =
    data && typeof data === 'object' && typeof (data as { storage_path?: unknown }).storage_path === 'string'
      ? (data as { storage_path: string }).storage_path
      : '';
  if (path) await removeQuiet([path]);
}
