import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveProfessionalDescription } from './professionalDescription';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

describe('descripción profesional del alta', () => {
  it('usa professional_description y, si no hay, el oficio', () => {
    expect(
      resolveProfessionalDescription({
        professionalDescription: '  Arreglo caños  ',
        tradeFallback: 'oficio',
      }),
    ).toBe('Arreglo caños');
    expect(
      resolveProfessionalDescription({ professionalDescription: '', tradeFallback: 'Plomero: pérdidas' }),
    ).toBe('Plomero: pérdidas');
    expect(resolveProfessionalDescription({ professionalDescription: '   ' })).toBeUndefined();
  });

  it('el alta no lee ni escribe la columna bio', () => {
    const src = read('src/services/supabaseUser.ts');
    const start = src.indexOf('async function writeOwnProfessionalDescription');
    const fn = src.slice(start, start + 1600);
    const rpc = fn.indexOf("rpc('update_professional_description'");
    const direct = fn.indexOf(".from('profiles')");
    expect(rpc).toBeGreaterThan(0);
    expect(direct).toBeGreaterThan(rpc);
    expect(src).not.toMatch(/\.update\(\{\s*bio:/);
    expect(src).not.toContain('PROFILE_PUBLIC_FULL');
    expect(src).toContain('payload.professionalDescription');
    const editor = read('src/screens/account/WorkerABMScreen.tsx');
    expect(editor).toContain('user?.professionalDescription');
    expect(editor).not.toContain('user?.bio');
  });

  it('la migración copia bio vacía de descripción y después borra la columna', () => {
    const sql = read('supabase/20261005_drop_profiles_bio.sql');
    expect(sql).toContain('btrim(coalesce(professional_description');
    expect(sql).toContain('professional_description = btrim(bio)');
    expect(sql).toContain('DROP COLUMN IF EXISTS bio');
    expect(sql).not.toMatch(/SET\s+bio\s*=/i);
    expect(sql).not.toContain('p.bio');
  });
});
