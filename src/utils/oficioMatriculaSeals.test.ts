import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATRICULA_OFICIO_CODIGOS } from './matriculaVerificada';
import { OFICIO_MATRICULA_SEALS, oficioMatriculaSeal, oficioSealPairs } from './oficioMatriculaSeals';

describe('sello de matrícula por oficio', () => {
  it('cada oficio mapea a un ícono y un color distintos', () => {
    const pairs = oficioSealPairs();
    expect(pairs.map((pair) => pair.code)).toEqual([...MATRICULA_OFICIO_CODIGOS]);
    expect(new Set(pairs.map((pair) => pair.icon)).size).toBe(pairs.length);
    expect(new Set(pairs.map((pair) => pair.ink)).size).toBe(pairs.length);
    expect(new Set(pairs.map((pair) => pair.wash)).size).toBe(pairs.length);

    const antecedentes = oficioMatriculaSeal('antecedentes');
    expect(antecedentes.icon).toBe('shield-checkmark');
    expect(pairs.every((pair) => pair.icon !== antecedentes.icon)).toBe(true);
    expect(pairs.every((pair) => pair.ink !== antecedentes.ink)).toBe(true);
  });

  it('feed, búsqueda y perfil leen la misma paleta', () => {
    const icon = readFileSync('src/components/profile/OficioMatriculaIcon.tsx', 'utf8');
    const badge = readFileSync('src/components/profile/MatriculaVerificadaBadge.tsx', 'utf8');
    const antecedentes = readFileSync('src/components/profile/AntecedentesPenalesBadge.tsx', 'utf8');
    const feed = readFileSync('src/components/feed/FeedPublicationMeta.tsx', 'utf8');
    const search = readFileSync('src/components/search/WorkerResultCard.tsx', 'utf8');
    const profile = readFileSync('src/screens/home/WorkerProfileScreen.tsx', 'utf8');

    expect(icon).toContain('oficioMatriculaSeal(');
    expect(icon).not.toContain("icon: 'flame'");
    expect(badge).toContain('oficioMatriculaSeal(code)');
    expect(badge).toContain('<OficioMatriculaIcon');
    expect(badge).toContain('name="ribbon"');
    expect(antecedentes).toContain('code="antecedentes"');
    expect(antecedentes).toContain('<OficioMatriculaIcon');
    expect(antecedentes).not.toContain('checkmark-circle');
    expect(feed).toContain('<OficioMatriculaIcon');
    expect(search).toContain('<OficioMatriculaIcon');
    expect(profile).toContain('parseFeedOficioCodes(worker.matriculasVerificadas)');
    expect(profile).toContain('<OficioMatriculaBadge');
    expect(profile).not.toContain('MatriculaVerificadaBadge');
    expect(OFICIO_MATRICULA_SEALS.gas.icon).toBe('flame');
    expect(OFICIO_MATRICULA_SEALS.electricidad.icon).toBe('flash');
    expect(OFICIO_MATRICULA_SEALS.plomeria.icon).toBe('water');
    expect(OFICIO_MATRICULA_SEALS.fumigacion.icon).toBe('leaf');
  });
});
