import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(__dirname, '../../supabase/20261026_card_115_116_ranking_materiales.sql'),
  'utf8',
);

/** Misma cuenta que el SQL, para fijar los números del ticket. */
function rankingScore(input: {
  allowsMaterials: boolean;
  rating: number;
  jobs: number;
  earned: number;
  materialsSent: number;
  daysInactive: number | null;
}): number {
  if (input.jobs <= 0) return 0.5;
  const stars = Math.min(Math.max(input.rating, 0), 5) / 5;
  const jobs = Math.min(1, Math.log(input.jobs + 1) / Math.log(101));
  const earned = Math.min(1, Math.log(input.earned + 1) / Math.log(1000001));
  const materials = Math.min(1, Math.log(input.materialsSent + 1) / Math.log(21));
  const base = input.allowsMaterials
    ? stars * 0.35 + jobs * 0.25 + earned * 0.25 + materials * 0.15
    : stars * 0.4 + jobs * 0.3 + earned * 0.3;
  const days = input.daysInactive;
  const factor =
    days == null || days <= 30 ? 1 : Math.max(0.5, 1 - (days - 30) * 0.0033);
  return Math.round(base * factor * 10000) / 10000;
}

describe('ranking #115 y check de materiales #116', () => {
  it('copia el cuerpo vivo y no le da EXECUTE a anon', () => {
    expect(sql).toContain('a421ef5c7e08c83f1b07e67a7addfa78');
    expect(sql).toContain('NULL::text AS apellido');
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[\s\S]{0,400}?\bTO\s+anon\b/i);
    expect(sql).toContain('FROM anon');
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.search_workers_public/i);
    expect(sql).not.toMatch(/DROP\s+FUNCTION[\s\S]{0,120}search_workers_public/i);
    expect(sql).not.toMatch(/FUNCTION\s+public\.(crear_cotizacion|editar_cotizacion|recotizar_en_curso)/);
    expect(sql).toContain("DEFAULT 'score'");
    expect(sql).toContain('ranking_score numeric');
  });

  it('la salida al cliente no lleva facturación ni el apellido real', () => {
    const out = sql.slice(sql.indexOf('-- salida al cliente'), sql.indexOf('FROM scored s'));
    expect(out).toContain('NULL::text AS apellido');
    expect(out).toContain('s.ranking_score');
    expect(out).not.toMatch(/precio_trabajador|earned|apellido_full/);
    expect(sql).toContain('allows_materials_list boolean NOT NULL DEFAULT true');
    expect(sql).toContain('admin_set_trade_allows_materials_list');
    expect(sql).toContain("status <> 'draft'");
    expect(sql).toContain("estado_pago = 'totalmente_pagado'");
    expect(sql).toContain("estado_trabajo = 'finalizado'");
    expect(sql).toContain('WHEN m.total_jobs_done <= 0 THEN 0.5000');
    expect(sql).toContain('* 0.35');
    expect(sql).toContain('* 0.15');
    expect(sql).toContain('* 0.0033');
    expect(sql).toContain('ln(101::numeric)');
    expect(sql).toContain('ln(1000001::numeric)');
    expect(sql).toContain('ln(21::numeric)');

    const screen = readFileSync(resolve(__dirname, '../screens/search/SearchWorkerScreen.tsx'), 'utf8');
    const sorts = readFileSync(resolve(__dirname, '../constants/workerSearchSort.ts'), 'utf8');
    const search = readFileSync(resolve(__dirname, '../services/searchWorkersSupabase.ts'), 'utf8');
    const card = readFileSync(resolve(__dirname, '../components/search/WorkerResultCard.tsx'), 'utf8');
    expect(sorts).toContain('Recomendados');
    expect(sorts).toContain('Más cercanos');
    expect(screen).toContain('WORKER_SEARCH_SORTS');
    expect(screen).not.toContain('ranking_score');
    expect(search).toContain('p_sort_by');
    expect(search).not.toContain('ranking_score');
    expect(search).not.toMatch(/apellido/);
    expect(card).not.toContain('ranking_score');
    expect(readFileSync(resolve(__dirname, '../screens/chat/ChatScreen.tsx'), 'utf8')).toContain(
      'materialsAllowed',
    );
  });

  it('el puntaje base de quien no tiene trabajos queda en el medio', () => {
    expect(rankingScore({
      allowsMaterials: true,
      rating: 0,
      jobs: 0,
      earned: 0,
      materialsSent: 0,
      daysInactive: 400,
    })).toBe(0.5);
    expect(rankingScore({
      allowsMaterials: false,
      rating: 5,
      jobs: 0,
      earned: 0,
      materialsSent: 20,
      daysInactive: null,
    })).toBe(0.5);
  });

  it('aplica la ponderación y el tope de inactividad', () => {
    expect(rankingScore({
      allowsMaterials: true,
      rating: 5,
      jobs: 100,
      earned: 1_000_000,
      materialsSent: 20,
      daysInactive: 10,
    })).toBe(1);
    expect(rankingScore({
      allowsMaterials: false,
      rating: 5,
      jobs: 100,
      earned: 1_000_000,
      materialsSent: 20,
      daysInactive: 10,
    })).toBe(1);
    const active = rankingScore({
      allowsMaterials: true,
      rating: 5,
      jobs: 100,
      earned: 1_000_000,
      materialsSent: 20,
      daysInactive: 31,
    });
    expect(active).toBe(0.9967);
    const floored = rankingScore({
      allowsMaterials: true,
      rating: 5,
      jobs: 100,
      earned: 1_000_000,
      materialsSent: 20,
      daysInactive: 182,
    });
    expect(floored).toBe(0.5);
  });
});
