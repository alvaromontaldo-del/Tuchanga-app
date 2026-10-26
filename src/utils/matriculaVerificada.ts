/** Matrícula verificada (#77). Las fotos viven en un bucket privado. */

import {
  ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX,
  ANTECEDENTES_IMAGE_MAX_EDGE_PX,
  ANTECEDENTES_IMAGE_TARGET_BYTES,
  ANTECEDENTES_JPEG_QUALITIES,
  ANTECEDENTES_PDF_MAX_BYTES,
} from './antecedentesPenales';
import { foldAccents } from './normalizeSearch';

export const MATRICULA_BUCKET = 'matriculas';

/** Tope de cada foto ya comprimida. El bucket repite este límite. */
export const MATRICULA_PHOTO_MAX_BYTES = ANTECEDENTES_PDF_MAX_BYTES;

/** Mismo lado largo que el certificado y el resto de las fotos de documento. */
export const MATRICULA_IMAGE_MAX_EDGE_PX = ANTECEDENTES_IMAGE_MAX_EDGE_PX;

export const MATRICULA_IMAGE_FALLBACK_EDGE_PX = ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX;

export const MATRICULA_IMAGE_TARGET_BYTES = ANTECEDENTES_IMAGE_TARGET_BYTES;

export const MATRICULA_JPEG_QUALITIES = ANTECEDENTES_JPEG_QUALITIES;

export const MATRICULA_MAX_PHOTOS = 3;

export const MATRICULA_NUMERO_MAX = 40;

export const MATRICULA_ENTIDAD_MAX = 80;

export const MATRICULA_SIGNED_URL_TTL_SEC = 600;

/**
 * Slugs del catálogo vivo. Electricista es `electricidad`;
 * fumigación es `control-plagas-fumigacion`.
 */
export const MATRICULA_TRADE_SLUGS = [
  'gasista',
  'electricidad',
  'plomeria',
  'control-plagas-fumigacion',
] as const;

/**
 * Nombres plegados, igual que `search_fold`: el catálogo dice «Gas» y «Electricidad»,
 * y el nombre viejo de la app era «Gasista».
 */
export const MATRICULA_TRADE_NAMES = [
  'gas',
  'gasista',
  'electricidad',
  'electricista',
  'plomeria',
  'plomero',
  'control de plagas y fumigacion',
  'fumigacion',
] as const;

const NUMERO_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,39}$/;

export type MatriculaStatus = 'pendiente' | 'aprobada' | 'rechazada';

export type MyMatricula = {
  status: MatriculaStatus;
  numero: string;
  entidad: string;
  motivo: string | null;
  fotos: number;
  updatedAt: string;
};

export type MatriculaTradeRef = {
  name?: string | null;
  rubroSlug?: string | null;
};

export function foldMatriculaTradeName(value: string): string {
  return foldAccents(value)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La carga es opcional y solo aparece en estos oficios. */
export function tradeRequiresMatricula(trade: MatriculaTradeRef): boolean {
  const slug = String(trade.rubroSlug ?? '').trim().toLowerCase();
  if ((MATRICULA_TRADE_SLUGS as readonly string[]).includes(slug)) return true;
  const name = foldMatriculaTradeName(String(trade.name ?? ''));
  return (MATRICULA_TRADE_NAMES as readonly string[]).includes(name);
}

export function profileOffersMatricula(trades: MatriculaTradeRef[]): boolean {
  return trades.some(tradeRequiresMatricula);
}

/** La tarjeta de carga solo si el oficio ya está guardado (la misma fuente que `jobs`). */
export const MATRICULA_SAVE_FIRST =
  'Guardá tus datos profesionales para cargar la matrícula';

export type MatriculaCardMode = 'ready' | 'save-first' | 'hidden';

/**
 * `saved` son los oficios ya persistidos del profesional.
 * Si el formulario tiene un oficio habilitado que todavía no se guardó, no se puede enviar.
 */
export function matriculaCardMode(
  saved: MatriculaTradeRef[],
  draft: MatriculaTradeRef[],
): MatriculaCardMode {
  if (profileOffersMatricula(saved)) return 'ready';
  if (profileOffersMatricula(draft)) return 'save-first';
  return 'hidden';
}

export function matriculaImageResize(
  width: number,
  height: number,
  maxEdge = MATRICULA_IMAGE_MAX_EDGE_PX,
): { width: number } | { height: number } | null {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  if (Math.max(w, h) <= maxEdge) return null;
  if (w >= h) return { width: maxEdge };
  return { height: maxEdge };
}

/** Nombre de objeto dentro de la carpeta del profesional. Solo jpg. */
export function matriculaObjectName(now = Date.now()): string {
  const stamp = String(Math.floor(now)).padStart(13, '0').slice(-13);
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, 'a').slice(0, 8);
  return `${stamp}-${rand}.jpg`;
}

export function matriculaDraftProblem(input: {
  numero: string;
  entidad: string;
  photos: number;
}): string | null {
  const numero = input.numero.trim();
  const entidad = input.entidad.trim();
  if (!numero) return 'Escribí el número de matrícula.';
  if (numero.length > MATRICULA_NUMERO_MAX || !NUMERO_RE.test(numero)) {
    return 'El número puede tener hasta 40 caracteres: letras, números y guiones.';
  }
  if (entidad.length < 2) return 'Escribí la entidad que la emitió.';
  if (entidad.length > MATRICULA_ENTIDAD_MAX) return 'La entidad puede tener hasta 80 caracteres.';
  if (/[\u0000-\u001F\u007F]/.test(entidad)) return 'La entidad tiene un carácter que no se puede guardar.';
  if (!Number.isFinite(input.photos) || input.photos < 1) return 'Sumá al menos una foto de la matrícula.';
  if (input.photos > MATRICULA_MAX_PHOTOS) return 'Podés cargar hasta 3 fotos.';
  return null;
}

export function parseMyMatricula(raw: unknown): MyMatricula | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const status = row.status;
  if (status !== 'pendiente' && status !== 'aprobada' && status !== 'rechazada') return null;
  const motivoRaw = typeof row.motivo === 'string' ? row.motivo.trim() : '';
  const fotos = Math.floor(Number(row.fotos));
  return {
    status,
    numero: typeof row.numero === 'string' ? row.numero.trim() : '',
    entidad: typeof row.entidad === 'string' ? row.entidad.trim() : '',
    motivo: status === 'rechazada' && motivoRaw ? motivoRaw : null,
    fotos: Number.isFinite(fotos) && fotos > 0 ? Math.min(MATRICULA_MAX_PHOTOS, fotos) : 0,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

export function matriculaUploadErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/could not find the function|schema cache|PGRST202|404/i.test(raw)) {
    return 'La carga de la matrícula todavía no está habilitada.';
  }
  return raw.trim() || 'No se pudo cargar la matrícula.';
}

export function previousMatriculaPaths(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { previous_paths?: unknown }).previous_paths;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const path = String(item ?? '').trim();
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}
