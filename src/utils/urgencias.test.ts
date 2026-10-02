import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATIENDE_URGENCIAS_FILTER,
  ATIENDE_URGENCIAS_HINT,
  ATIENDE_URGENCIAS_TITLE,
  URGENCIAS_BADGE_LABEL,
  filterSearchHitsByUrgencias,
  readAtiendeUrgencias,
  toggleAtiendeUrgencias,
  urgenciasBadgeView,
  isMissingUrgenciasSchema,
} from './urgencias';

const ROOT = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

describe('badge de urgencias', () => {
  it('pinta la píldora roja/naranja solo cuando el profesional atiende', () => {
    expect(urgenciasBadgeView(true)).toEqual({
      label: URGENCIAS_BADGE_LABEL,
      icon: 'flash',
      tone: 'red-orange',
    });
    expect(URGENCIAS_BADGE_LABEL).toBe('Urgencias 24 h');
    expect(urgenciasBadgeView(false)).toBeNull();
    expect(urgenciasBadgeView(undefined)).toBeNull();
    expect(urgenciasBadgeView(null)).toBeNull();
  });

  it('la tarjeta de búsqueda y el perfil público montan el badge con el flag', () => {
    const card = read('src/components/search/WorkerResultCard.tsx');
    expect(card).toContain('urgenciasBadgeView(worker.atiendeUrgencias)');
    expect(card).toContain('<UrgenciasBadge />');

    const profile = read('src/screens/home/WorkerProfileScreen.tsx');
    expect(profile).toContain('urgenciasBadgeView(worker.atiendeUrgencias)');
    expect(profile).toContain('<UrgenciasBadge />');

    const badge = read('src/components/search/UrgenciasBadge.tsx');
    expect(badge).toContain('BADGE.label');
    expect(badge).toContain('accessibilityLabel={BADGE.label}');
    expect(badge).toContain('#E65100');
    expect(badge).toContain('name={BADGE.icon}');
  });

  it('un valor que no es true no enciende el badge', () => {
    expect(readAtiendeUrgencias(true)).toBe(true);
    expect(readAtiendeUrgencias(false)).toBe(false);
    expect(readAtiendeUrgencias('true')).toBe(false);
    expect(readAtiendeUrgencias(1)).toBe(false);
    expect(readAtiendeUrgencias(null)).toBe(false);
  });
});

describe('filtro Atiende urgencias', () => {
  const hits = [
    { worker: { id: 'cerca', atiendeUrgencias: false }, distanceKm: 1.2 },
    { worker: { id: 'medio', atiendeUrgencias: true }, distanceKm: 2 },
    { worker: { id: 'empate', atiendeUrgencias: true }, distanceKm: 2 },
    { worker: { id: 'lejos', atiendeUrgencias: false }, distanceKm: 8 },
  ];

  it('apagado deja el mismo arreglo, el orden y la distancia', () => {
    expect(filterSearchHitsByUrgencias(hits, false)).toBe(hits);
    expect(ATIENDE_URGENCIAS_FILTER).toBe('Atiende urgencias');
  });

  it('encendido recorta sin reordenar', () => {
    expect(filterSearchHitsByUrgencias(hits, true).map((hit) => hit.worker.id)).toEqual([
      'medio',
      'empate',
    ]);
  });
});

describe('toggle Atiendo urgencias', () => {
  it('cambia el valor y usa el texto de la ficha', () => {
    expect(toggleAtiendeUrgencias(false)).toBe(true);
    expect(toggleAtiendeUrgencias(true)).toBe(false);
    expect(ATIENDE_URGENCIAS_TITLE).toBe('Atiendo urgencias');
    expect(ATIENDE_URGENCIAS_HINT).toBe(
      'Los clientes van a ver que atendés urgencias en cualquier horario.',
    );
  });

  it('el perfil profesional lo guarda con el botón existente, vía RPC', () => {
    const screen = read('src/screens/account/WorkerABMScreen.tsx');
    expect(screen).toContain('ATIENDE_URGENCIAS_TITLE');
    expect(screen).toContain('ATIENDE_URGENCIAS_HINT');
    expect(screen).toContain('<Switch');
    expect(screen).toContain('toggleAtiendeUrgencias(current)');
    expect(screen).toContain('setMyAtiendeUrgencias(atiendeUrgencias)');
    expect(screen).toContain('title="Guardar"');
    expect(isMissingUrgenciasSchema('function set_my_atiende_urgencias does not exist')).toBe(true);
    expect(isMissingUrgenciasSchema('permission denied')).toBe(false);
  });
});

describe('SQL de urgencias', () => {
  const sql = read('supabase/20261002_card_95_atiende_urgencias.sql');

  it('agrega la columna y el RPC solo del usuario logueado, sin UPDATE directo', () => {
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS atiende_urgencias boolean NOT NULL DEFAULT false',
    );
    expect(sql).toContain('FUNCTION public.set_my_atiende_urgencias(p_value boolean)');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('v_uid uuid := auth.uid()');
    expect(sql).toContain('WHERE id = v_uid');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.set_my_atiende_urgencias(boolean) FROM PUBLIC',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.set_my_atiende_urgencias(boolean) FROM anon',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.set_my_atiende_urgencias(boolean) TO authenticated',
    );
    expect(sql).not.toMatch(/GRANT\s+UPDATE/i);
    expect(sql).not.toMatch(/GRANT\s+INSERT/i);
    expect(sql).toContain(
      'REVOKE ALL (atiende_urgencias) ON public.profiles FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain('GRANT SELECT (atiende_urgencias) ON public.profiles TO authenticated');
  });

  it('recrea las dos búsquedas con el apellido oculto y el mismo orden', () => {
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.search_workers_for_client(double precision, double precision, text, text[], uuid, integer)',
    );
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.search_workers_public(text, text, text, integer)',
    );
    expect(sql.match(/NULL::text AS apellido/g)).toHaveLength(1);
    expect(sql).not.toMatch(/apellido_full\s+ILIKE/i);
    expect(sql).toContain('ORDER BY b.distance_exact ASC, b.rating_average DESC NULLS LAST');
    expect(sql).toContain('WHERE b.distance_exact <= b.coverage_km');
    expect(sql).toContain('ORDER BY b.rating DESC, b.resenas_count DESC, b.nombre');
    expect(sql).toContain("split_part(coalesce(p.nombre, ''), ' ', 1)");
    const publicFn = sql.slice(sql.indexOf('CREATE FUNCTION public.search_workers_public'));
    expect(publicFn).not.toMatch(/apellido/i);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.search_workers_for_client');
    expect(sql).toContain('TO anon');
    expect(sql).toContain('TO authenticated');
    expect(sql).toContain('TO service_role');
    expect(sql).toContain('b.atiende_urgencias');
  });
});
