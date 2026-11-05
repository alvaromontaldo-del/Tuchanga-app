import { professionalDisplayNameForClient } from './professionalDisplayName';
import { canShowWorkerReputation } from './workerReputation';
import { MATRICULA_OFICIO_CODIGOS, type MatriculaOficioCodigo } from './matriculaVerificada';

export type FeedTrustIcon = 'antecedentes' | MatriculaOficioCodigo;

const OFICIO_SET = new Set<string>(MATRICULA_OFICIO_CODIGOS);

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

export function parseFeedOficioCodes(raw: unknown): MatriculaOficioCodigo[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      items = trimmed
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    }
  }
  return feedTrustIcons(false, items).filter((icon): icon is MatriculaOficioCodigo => icon !== 'antecedentes');
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
