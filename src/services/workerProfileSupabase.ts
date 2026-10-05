import { getSupabaseClient } from '../lib/supabase';
import type { WorkerPublicProfile, WorkerTradeEntry } from '../types/feed';
import { MAX_WORKER_TRADES } from '../types/feed';
import { professionalDisplayNameForClient } from '../utils/professionalDisplayName';
import { completedJobsFromPayload } from '../utils/workerReputation';
import { fetchIntroVideoPath, playbackUrlForPath } from './introVideoSupabase';
import { fetchMyProfilePrivate } from './supabaseUser';
import { fetchWorkerAtiendeUrgencias } from './urgenciasSupabase';

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?u=profile';

/** Normaliza photo_urls de PostgREST / Postgres (array, string JSON o literal {a,b}). */
function normalizePhotoUrls(raw: unknown, fotoUrl?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: unknown) => {
    const s = String(u ?? '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  if (Array.isArray(raw)) {
    for (const u of raw) push(u);
  } else if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) for (const u of parsed) push(u);
        else push(t);
      } catch {
        push(t);
      }
    } else if (t.startsWith('{') && t.endsWith('}')) {
      // Postgres text[] literal: {url1,url2} o {"url1","url2"}
      const inner = t.slice(1, -1).trim();
      if (inner) {
        const parts = inner.match(/(?:"(?:\\.|[^"])*"|[^,]+)/g) ?? [];
        for (const p of parts) {
          let s = p.trim();
          if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/\\"/g, '"');
          push(s);
        }
      }
    } else {
      push(t);
    }
  }

  if (fotoUrl?.trim()) {
    const first = fotoUrl.trim();
    if (!seen.has(first)) {
      out.unshift(first);
      seen.add(first);
    }
  }

  return out.slice(0, 5);
}

type TradePhotoRow = {
  nombre_oficio?: string | null;
  foto_url?: string | null;
  photo_urls?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    try {
      return asRecord(JSON.parse(t) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function yearsOf(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(60, n));
}

function clampRating(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function mapTrades(raw: unknown): WorkerTradeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkerTradeEntry[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const title = String(row.nombre ?? '').trim();
    if (!title) continue;
    const description = String(row.descripcion ?? '').trim() || 'Servicios a medida.';
    out.push({
      title,
      description,
      yearsExperience: yearsOf(row.anos_experiencia),
    });
  }
  return out.slice(0, MAX_WORKER_TRADES);
}

/**
 * Arma el perfil público desde `get_public_worker_profile`.
 * El RPC ya devuelve solo el nombre de pila. No lee ni copia el apellido.
 * Sin oficios (mismo criterio que la búsqueda) devuelve null.
 */
export function mapPublicWorkerRpcPayload(raw: unknown): WorkerPublicProfile | null {
  const root = asRecord(raw);
  if (!root) return null;
  const profile = asRecord(root.profile);
  if (!profile) return null;

  const id = String(profile.id ?? '').trim();
  if (!id) return null;

  const trades = mapTrades(root.habilidades);
  if (trades.length === 0) return null;

  const primaryTitle =
    String(profile.oficio ?? '').trim() || trades[0]?.title || 'Servicios';
  const professionalDesc = String(profile.descripcion ?? '').trim();
  const firstName = professionalDisplayNameForClient(String(profile.nombre ?? ''));
  const avatar = String(profile.avatar ?? '').trim();

  return {
    id,
    firstName,
    trade: primaryTitle,
    avatarUrl: avatar || `${DEFAULT_AVATAR}&id=${encodeURIComponent(id)}`,
    professionalDescription:
      professionalDesc ||
      trades.map((t) => `${t.title}: ${t.description}`).join(' ').slice(0, 280) ||
      'Profesional registrado en YaChanga.',
    ratingAverage: clampRating(profile.rating),
    reviewCount: Math.max(0, Math.floor(Number(profile.resenas_count) || 0)),
    totalJobsDone: completedJobsFromPayload(profile, 'total_jobs_done') ?? 0,
    trades,
  };
}

function mergeTradePhotos(trades: WorkerTradeEntry[], rows: TradePhotoRow[]): WorkerTradeEntry[] {
  const byTitle = new Map<string, string[]>();
  for (const row of rows) {
    const title = String(row.nombre_oficio ?? '').trim().toLowerCase();
    const photos = normalizePhotoUrls(row.photo_urls, row.foto_url);
    if (title && photos.length) byTitle.set(title, photos);
  }
  if (byTitle.size === 0) return trades;
  return trades.map((trade) => {
    const photos = byTitle.get(trade.title.trim().toLowerCase());
    return photos?.length ? { ...trade, photoUrls: photos } : trade;
  });
}

async function settle<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

async function fetchTradePhotoRows(workerUserId: string): Promise<TradePhotoRow[]> {
  return settle(async () => {
    const sb = getSupabaseClient();
    const rpc = await sb.rpc('fetch_worker_trades', { p_worker_id: workerUserId });
    if (rpc.error || !Array.isArray(rpc.data)) return [];
    return rpc.data as TradePhotoRow[];
  }, []);
}

/**
 * Perfil público de un profesional aceptado.
 * Usa `get_public_worker_profile` (SECURITY DEFINER): misma puerta que la búsqueda
 * (aceptado, cobertura y oficios) y solo el nombre de pila.
 * El video, las urgencias, las fotos y la fecha de nacimiento no anulan el perfil.
 */
export async function fetchWorkerPublicProfileFromSupabase(
  workerUserId: string,
): Promise<WorkerPublicProfile | null> {
  const id = workerUserId.trim();
  if (!id) return null;

  const sb = getSupabaseClient();
  const rpc = await sb.rpc('get_public_worker_profile', { p_worker_id: id });
  if (rpc.error || rpc.data == null) return null;

  const mapped = mapPublicWorkerRpcPayload(rpc.data);
  if (!mapped) return null;

  // Canales aparte: un fallo acá no puede anular el perfil ya armado.
  const [introPath, atiendeUrgencias, photoRows] = await Promise.all([
    settle(() => fetchIntroVideoPath(id), null),
    settle(() => fetchWorkerAtiendeUrgencias(id), false),
    fetchTradePhotoRows(id),
  ]);

  let birthDate = '';
  let introVideoUrl: string | null = null;
  try {
    const {
      data: { user: sessionUser },
    } = await sb.auth.getUser();
    if (sessionUser?.id === id) {
      const priv = await fetchMyProfilePrivate();
      birthDate = priv?.birth_date ?? '';
    }
  } catch {
    birthDate = '';
  }
  try {
    introVideoUrl = playbackUrlForPath(introPath);
  } catch {
    introVideoUrl = null;
  }

  return {
    ...mapped,
    trades: mergeTradePhotos(mapped.trades, photoRows),
    introVideoUrl,
    birthDate: birthDate || undefined,
    atiendeUrgencias,
  };
}
