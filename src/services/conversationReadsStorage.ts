import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY = 'tu-changa:conversation-reads:v1';

type AllReads = Record<string, Record<string, string>>;

function parse(raw: string | null): AllReads {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AllReads;
  } catch {
    return {};
  }
}

async function readAll(): Promise<AllReads> {
  if (Platform.OS === 'web') {
    try {
      return parse(localStorage.getItem(KEY));
    } catch {
      return {};
    }
  }
  return parse(await AsyncStorage.getItem(KEY));
}

async function writeAll(all: AllReads): Promise<void> {
  const raw = JSON.stringify(all);
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      /* ignore */
    }
    return;
  }
  await AsyncStorage.setItem(KEY, raw);
}

/** Marca hasta qué instante el usuario leyó el hilo (ISO). */
export async function setConversationLastRead(
  userId: string,
  conversationId: string,
  readAtIso: string,
): Promise<void> {
  const all = await readAll();
  if (!all[userId]) all[userId] = {};
  const prev = all[userId][conversationId];
  if (prev && new Date(readAtIso) <= new Date(prev)) return;
  all[userId][conversationId] = readAtIso;
  await writeAll(all);
}

export async function getConversationLastRead(
  userId: string,
  conversationId: string,
): Promise<string | null> {
  const all = await readAll();
  return all[userId]?.[conversationId] ?? null;
}

export async function loadAllReadsForUser(userId: string): Promise<Record<string, string>> {
  const all = await readAll();
  return all[userId] ?? {};
}

/** Borra el registro local de lectura para un hilo (ej. al eliminar conversación). */
export async function clearConversationLastRead(
  userId: string,
  conversationId: string,
): Promise<void> {
  const all = await readAll();
  if (!all[userId] || !all[userId][conversationId]) return;
  const next = { ...all };
  next[userId] = { ...next[userId] };
  delete next[userId][conversationId];
  await writeAll(next);
}
