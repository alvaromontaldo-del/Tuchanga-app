import { professionalDisplayNameForClient } from './professionalDisplayName';
import { canShowWorkerReputation } from './workerReputation';
import { MATRICULA_OFICIO_CODIGOS, type MatriculaOficioCodigo } from './matriculaVerificada';

export type FeedTrustIcon = 'antecedentes' | MatriculaOficioCodigo;

const OFICIO_SET = new Set<string>(MATRICULA_OFICIO_CODIGOS);

/** Leyenda del perfil. El feed y la búsqueda no la muestran. */
const OFICIO_LEGEND: Record<MatriculaOficioCodigo, string> = {
  gas: 'Matrícula de gas verificada',
  electricidad: 'Matrícula de electricidad verificada',
  plomeria: 'Matrícula de plomería verificada',
  fumigacion: 'Matrícula de fumigación verificada',
};

/**
 * Íconos del feed, sin texto: antecedentes solo si está aprobado,
 * y después cada oficio con matrícula verificada. El legado sin vínculo no entra.
 */
export function feedTrustIcons(
  antecedentesAprobado: boolean,
  oficios: readonly unknown[],
): FeedTrustIcon[] {
  const icons: FeedTrustIcon[] = [];
  if (antecedentesAprobado) icons.push('antecedentes');
  const present = new Set(oficios.map((item) => String(item ?? '').trim()).filter(Boolean));
  for (const code of MATRICULA_OFICIO_CODIGOS) {
    if (present.has(code) && OFICIO_SET.has(code)) icons.push(code);
  }
  return icons;
}

/**
 * Leyendas del perfil público, en orden: antecedentes y después cada oficio.
 * No incluye número, entidad ni el legado sin vínculo.
 */
export function profileTrustLegends(antecedentes: boolean, oficios: readonly unknown[]): string[] {
  const lines: string[] = [];
  if (antecedentes) lines.push('Antecedentes penales');
  for (const icon of feedTrustIcons(false, oficios)) {
    if (icon === 'antecedentes') continue;
    lines.push(OFICIO_LEGEND[icon]);
  }
  return lines;
}

/** Tilde genérico cuando el perfil público dice matrícula y no hay oficios. */
export const MATRICULA_VERIFICADA_LABEL = 'Matrícula verificada';

/**
 * Leyendas de matrícula del perfil.
 * Con oficios de `worker_public_trust`, una por oficio.
 * Sin oficios (visitante, error o lista vacía) y con el boolean de
 * `get_public_worker_profile`, el tilde genérico de antes.
 */
export function profileMatriculaLabels(input: {
  matriculaVerificada?: boolean | null;
  oficios?: readonly unknown[] | null;
}): string[] {
  const specific = profileTrustLegends(false, input.oficios ?? []);
  if (specific.length > 0) return specific;
  if (input.matriculaVerificada === true) return [MATRICULA_VERIFICADA_LABEL];
  return [];
}

export function parseFeedOficioCodes(raw: unknown): MatriculaOficioCodigo[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = [];
      }
    } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      items = trimmed
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    }
  }
  return feedTrustIcons(false, items).filter((icon): icon is MatriculaOficioCodigo => icon !== 'antecedentes');
}

export type WorkerPublicTrustSeal = {
  antecedentes: boolean;
  oficios: MatriculaOficioCodigo[];
};

function asTrustRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Filas de `worker_public_trust`. Ignora el legado y cualquier código que no sea un oficio. */
export function parseWorkerPublicTrustRows(raw: unknown): Map<string, WorkerPublicTrustSeal> {
  const out = new Map<string, WorkerPublicTrustSeal>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const row = asTrustRecord(item);
    if (!row) continue;
    const id = String(row.profile_id ?? '').trim();
    if (!id) continue;
    out.set(id, {
      antecedentes: row.antecedentes_penales === true,
      oficios: parseFeedOficioCodes(row.matriculas_verificadas),
    });
  }
  return out;
}

/** Campos de sello que `fetch_feed_posts` agrega a cada fila. */
export function feedPostTrustFromRpc(row: {
  worker_antecedentes_aprobado?: unknown;
  worker_matriculas_verificadas?: unknown;
}): { workerAntecedentesAprobado: boolean; workerMatriculasVerificadas: MatriculaOficioCodigo[] } {
  return {
    workerAntecedentesAprobado: row.worker_antecedentes_aprobado === true,
    workerMatriculasVerificadas: parseFeedOficioCodes(row.worker_matriculas_verificadas),
  };
}

/** Una estrella, el puntaje y la cantidad de trabajos. El nombre ya viene recortado. */
export function feedScoreLabel(score: number | null | undefined, jobs: number | null | undefined): string {
  const safeScore =
    typeof score === 'number' && Number.isFinite(score) ? Math.min(5, Math.max(0, score)) : 0;
  const scoreText = safeScore.toFixed(1);
  if (typeof jobs !== 'number' || !Number.isFinite(jobs)) return scoreText;
  return `${scoreText} (${Math.max(0, Math.floor(jobs))})`;
}

/**
 * Inicio: con menos de 2 trabajos finalizados se muestra «Nuevo» y no el puntaje.
 * Si el dato no vino (`undefined`), se mantiene el puntaje (payload viejo).
 */
export function feedHomeShowsNuevo(jobs: number | null | undefined): boolean {
  return jobs !== undefined && !canShowWorkerReputation(jobs);
}

/** Línea del feed: solo nombre de pila, una estrella, puntaje y trabajos. */
export function feedPublicationLine(
  nombre: string | null | undefined,
  score: number | null | undefined,
  jobs: number | null | undefined,
): string {
  return `${professionalDisplayNameForClient(nombre)} ★ ${feedScoreLabel(score, jobs)}`;
}
