import { File as ExpoFsFile } from 'expo-file-system';
import { getSupabaseClient } from '../lib/supabase';
import { mapChatSendError } from '../utils/chatErrors';
import { normalizeLocalImageUri } from '../utils/normalizeLocalImage';
import { storageOwnerFolder } from '../utils/storageOwnerFolder';
import type { ApiMessage } from './chatApi';

const IMAGE_BODY_PREVIEW = '📷 Foto';

function guessMime(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function isAllowedImageMime(mime: string): boolean {
  return /^(image\/(jpeg|jpg|png|webp|heic|heif))$/i.test(mime.trim());
}

async function readUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (/^https?:\/\//i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status}).`);
    return res.arrayBuffer();
  }
  try {
    const file = new ExpoFsFile(uri);
    return file.arrayBuffer();
  } catch {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('No se pudo leer la imagen (archivo local).');
    return res.arrayBuffer();
  }
}

async function resolveOwnerFolder(userId: string): Promise<string> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from('profiles')
    .select('dni,apellido')
    .eq('id', userId)
    .maybeSingle();
  return storageOwnerFolder({
    userId,
    dni: (data as { dni?: string | null } | null)?.dni,
    lastName: (data as { apellido?: string | null } | null)?.apellido,
  });
}

async function uploadChatImage(params: {
  userId: string;
  conversationId: string;
  uri: string;
}): Promise<string> {
  const sb = getSupabaseClient();
  // Mismo filtro que oficios/publicaciones: máx. 1200px + JPEG 0.7
  const preparedUri = await normalizeLocalImageUri(params.uri, { squareCrop: false });
  const mime = guessMime(preparedUri);
  if (!isAllowedImageMime(mime) && !mime.startsWith('image/')) {
    throw new Error('Solo se admiten archivos de imagen.');
  }
  const folder = await resolveOwnerFolder(params.userId);
  const path = `${folder}/chat/${params.conversationId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.jpg`;

  const buf = await readUriAsArrayBuffer(preparedUri);
  const bytes = new Uint8Array(buf);
  if (!bytes.byteLength) {
    throw new Error('La imagen quedó vacía. Probá con otra foto.');
  }

  const { error } = await sb.storage.from('job-photos').upload(path, bytes, {
    upsert: false,
    contentType: 'image/jpeg',
    cacheControl: '3600',
  });
  if (error) {
    throw new Error(
      error.message?.includes('row-level security')
        ? 'No se pudo subir la imagen (permisos de Storage).'
        : error.message || 'No se pudo subir la imagen.',
    );
  }

  const { data } = sb.storage.from('job-photos').getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Sube la imagen (comprimida) y crea un mensaje type=image (solo cliente del hilo).
 */
export async function sendChatImageMessageSupabase(
  conversationId: string,
  localImageUri: string,
): Promise<ApiMessage> {
  const sb = getSupabaseClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.id) throw new Error('No autenticado');

  const { data: conv, error: ce } = await sb
    .from('conversations')
    .select('cliente_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (ce || !conv) throw new Error('Conversación no encontrada.');
  if (conv.cliente_id !== user.id) {
    throw new Error('Solo el cliente puede enviar imágenes en este chat.');
  }

  const imageUrl = await uploadChatImage({
    userId: user.id,
    conversationId,
    uri: localImageUri,
  });

  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: IMAGE_BODY_PREVIEW,
      type: 'image',
      metadata: { image_url: imageUrl },
    })
    .select('id,conversation_id,sender_id,body,type,metadata,created_at')
    .single();

  if (error || !data) {
    throw new Error(mapChatSendError(error));
  }

  return {
    id: data.id,
    conversation_id: data.conversation_id,
    sender_id: data.sender_id,
    text: data.body,
    status: 'sent',
    created_at: data.created_at,
    type: 'image',
    metadata: (data.metadata as Record<string, unknown> | null) ?? { image_url: imageUrl },
  };
}

export { IMAGE_BODY_PREVIEW };
