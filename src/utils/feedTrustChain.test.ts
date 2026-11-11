import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  feedPostTrustFromRpc,
  feedTrustIcons,
  parseWorkerPublicTrustRows,
  profileMatriculaLabels,
  profileTrustLegends,
} from './feedTrust';

const rpcRow = {
  id: 'p1',
  worker_id: 'w1',
  trade: 'Gas',
  description: 'Cocina',
  image_urls: ['https://cdn.example/obra.jpg'],
  created_at: '2026-11-01T00:00:00.000Z',
  worker_nombre: 'Horacio',
  worker_avatar_url: '',
  worker_rating_average: 4.3,
  worker_review_count: 6,
  worker_total_jobs_done: 6,
  like_count: 2,
  liked_by_me: false,
};

describe('cadena dato → ícono (#214)', () => {
  it('fetch_feed_posts llega al sello y el legado no genera ícono', () => {
    const post = feedPostTrustFromRpc({
      ...rpcRow,
      worker_antecedentes_aprobado: true,
      worker_matriculas_verificadas: '{gas,sin_vincular,electricidad}',
    });
    expect(post.workerAntecedentesAprobado).toBe(true);
    expect(post.workerMatriculasVerificadas).toEqual(['gas', 'electricidad']);

    const icons = feedTrustIcons(post.workerAntecedentesAprobado, post.workerMatriculasVerificadas);
    expect(icons).toEqual(['antecedentes', 'gas', 'electricidad']);
    expect(feedTrustIcons(false, ['sin_vincular'])).toEqual([]);

    const fromJson = feedPostTrustFromRpc({
      worker_antecedentes_aprobado: false,
      worker_matriculas_verificadas: '["plomeria","pendiente"]',
    });
    expect(feedTrustIcons(fromJson.workerAntecedentesAprobado, fromJson.workerMatriculasVerificadas)).toEqual([
      'plomeria',
    ]);

    const mapper = readFileSync('src/services/supabasePosts.ts', 'utf8');
    expect(mapper).toContain('...feedPostTrustFromRpc(x)');

    const feed = readFileSync('src/context/FeedContext.tsx', 'utf8');
    expect(feed).toContain('workerAntecedentesAprobado: r.workerAntecedentesAprobado');
    expect(feed).toContain('workerMatriculasVerificadas: r.workerMatriculasVerificadas');

    const card = readFileSync('src/components/feed/ChangaImagePost.tsx', 'utf8');
    expect(card).toContain('antecedentesAprobado={post.workerAntecedentesAprobado}');
    expect(card).toContain('oficios={post.workerMatriculasVerificadas}');
    expect(card).toContain('showScore={!showNuevo}');

    const meta = readFileSync('src/components/feed/FeedPublicationMeta.tsx', 'utf8');
    expect(meta).toContain('<OficioMatriculaIcon');
    expect(meta).not.toContain('Antecedentes penales');
    expect(meta).not.toContain('Matrícula de');
    const icon = readFileSync('src/components/profile/OficioMatriculaIcon.tsx', 'utf8');
    expect(icon).not.toContain('<Text');
  });

  it('búsqueda: solo íconos. Perfil: la leyenda del oficio', () => {
    const seals = parseWorkerPublicTrustRows([
      {
        profile_id: 'w1',
        antecedentes_penales: true,
        matriculas_verificadas: ['fumigacion', 'sin_vincular', 'gas'],
      },
    ]);
    const trust = seals.get('w1');
    expect(feedTrustIcons(trust?.antecedentes === true, trust?.oficios ?? [])).toEqual([
      'antecedentes',
      'gas',
      'fumigacion',
    ]);
    expect(profileTrustLegends(true, trust?.oficios ?? [])).toEqual([
      'Antecedentes penales',
      'Matrícula de gas verificada',
      'Matrícula de fumigación verificada',
    ]);
    expect(profileTrustLegends(false, ['sin_vincular', 'no-existe'])).toEqual([]);
    expect(profileTrustLegends(true, [])).toEqual(['Antecedentes penales']);

    const searchCard = readFileSync('src/components/search/WorkerResultCard.tsx', 'utf8');
    expect(searchCard).toContain('feedTrustIcons(');
    expect(searchCard).toContain('<OficioMatriculaIcon');
    expect(searchCard).not.toContain('AntecedentesPenalesBadge');
    expect(searchCard).not.toContain('MatriculaVerificadaBadge');
    expect(searchCard).not.toContain('Antecedentes penales');
    expect(searchCard).not.toContain('Matrícula');

    const profile = readFileSync('src/screens/home/WorkerProfileScreen.tsx', 'utf8');
    expect(profile).toContain('<AntecedentesPenalesBadge />');
    expect(profile).toContain('profileMatriculaLabels({');
    expect(profile).toContain('matriculaVerificada: worker.matriculaVerificada');
    expect(profile).toContain('oficios: worker.matriculasVerificadas');
    expect(profile).toContain('<MatriculaVerificadaBadge key={label} label={label} />');

    const sql = readFileSync('supabase/20261111_card_214_trust_seals.sql', 'utf8');
    expect(sql).toContain('worker_public_trust');
    expect(sql).toContain('_matriculas_oficios_verificados');
    expect(sql).toContain('_worker_antecedentes_aprobado');
    expect(sql).not.toMatch(/\bnumero\b/);
    expect(sql).not.toMatch(/storage_path/);
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.worker_public_trust(uuid[]) FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.worker_public_trust(uuid[]) TO authenticated, service_role',
    );
    expect(sql).not.toMatch(/worker_public_trust\(uuid\[\]\)\s+TO\s+anon/);
    expect(sql).not.toMatch(/anon puede ejecutar/i);
  });

  it('sin oficios y con el boolean público muestra el tilde genérico', () => {
    expect(
      profileMatriculaLabels({ matriculaVerificada: true, oficios: [] }),
    ).toEqual(['Matrícula verificada']);
    expect(
      profileMatriculaLabels({ matriculaVerificada: true, oficios: null }),
    ).toEqual(['Matrícula verificada']);
    expect(
      profileMatriculaLabels({ matriculaVerificada: true, oficios: undefined }),
    ).toEqual(['Matrícula verificada']);
    expect(
      profileMatriculaLabels({ matriculaVerificada: true, oficios: ['sin_vincular'] }),
    ).toEqual(['Matrícula verificada']);
    expect(
      profileMatriculaLabels({ matriculaVerificada: true, oficios: ['gas', 'sin_vincular'] }),
    ).toEqual(['Matrícula de gas verificada']);
    expect(
      profileMatriculaLabels({ matriculaVerificada: false, oficios: [] }),
    ).toEqual([]);
    expect(profileMatriculaLabels({ matriculaVerificada: false, oficios: ['plomeria'] })).toEqual([
      'Matrícula de plomería verificada',
    ]);
  });
});
