/** Certificado de antecedentes penales (#110). El archivo es privado. */

export const ANTECEDENTES_GOB_URL =
  'https://www.argentina.gob.ar/justicia/reincidencia/antecedentespenales';

export const ANTECEDENTES_BUCKET = 'antecedentes-penales';

/** Tope del PDF y de la foto ya comprimida. El bucket repite este límite. */
export const ANTECEDENTES_PDF_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Lado largo de la foto. 1600 px alcanza para leer un certificado A4
 * y baja mucho el peso frente a la foto original de la cámara.
 */
export const ANTECEDENTES_IMAGE_MAX_EDGE_PX = 1600;

/** Si con la primera pasada sigue pesada, se baja a este lado. Sigue siendo legible. */
export const ANTECEDENTES_IMAGE_FALLBACK_EDGE_PX = 1200;

/** Objetivo de peso. Por debajo de esto no se sigue bajando la calidad. */
export const ANTECEDENTES_IMAGE_TARGET_BYTES = 350 * 1024;

/**
 * Calidades JPEG, de mayor a menor. El piso es 0.34: más abajo el texto
 * del certificado se empasta.
 */
export const ANTECEDENTES_JPEG_QUALITIES = [0.55, 0.42, 0.34] as const;

export const ANTECEDENTES_SIGNED_URL_TTL_SEC = 600;

export type AntecedentesStatus = 'pendiente' | 'aprobado' | 'rechazado';

export type MyAntecedentes = {
  status: AntecedentesStatus;
  asunto: string | null;
  mimeType: string;
  updatedAt: string;
};

export function antecedentesPdfRejected(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'El PDF está vacío.';
  if (bytes > ANTECEDENTES_PDF_MAX_BYTES) {
    return 'El PDF no puede superar 2 MB. Exportalo más liviano y volvé a cargarlo.';
  }
  return null;
}

export function antecedentesImageResize(
  width: number,
  height: number,
  maxEdge = ANTECEDENTES_IMAGE_MAX_EDGE_PX,
): { width: number } | { height: number } | null {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  if (Math.max(w, h) <= maxEdge) return null;
  if (w >= h) return { width: maxEdge };
  return { height: maxEdge };
}

/** Nombre de objeto dentro de la carpeta del profesional. Solo jpg o pdf. */
export function antecedentesObjectName(kind: 'jpg' | 'pdf', now = Date.now()): string {
  const stamp = String(Math.floor(now)).padStart(13, '0').slice(-13);
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, 'a').slice(0, 8);
  return `${stamp}-${rand}.${kind}`;
}

export function parseMyAntecedentes(raw: unknown): MyAntecedentes | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const status = row.status;
  if (status !== 'pendiente' && status !== 'aprobado' && status !== 'rechazado') return null;
  const asuntoRaw = typeof row.asunto === 'string' ? row.asunto.trim() : '';
  return {
    status,
    asunto: asuntoRaw || null,
    mimeType: typeof row.mime_type === 'string' ? row.mime_type : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

export function antecedentesUploadErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/native module|ExponentDocumentPicker|expo-document-picker/i.test(raw)) {
    return 'Para adjuntar un PDF actualizá la app. Mientras tanto podés sacar una foto del certificado.';
  }
  if (/could not find the function|schema cache|PGRST202|404/i.test(raw)) {
    return 'La carga del certificado todavía no está habilitada.';
  }
  return raw.trim() || 'No se pudo cargar el certificado.';
}

/** Ids aprobados que devolvió el RPC público. Ignora basura. */
export function approvedAntecedentesIds(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  for (const item of raw) {
    const id = String(item ?? '').trim();
    if (id) out.add(id);
  }
  return out;
}
