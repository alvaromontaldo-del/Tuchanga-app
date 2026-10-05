import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { professionalDescriptionColumns, resolveAccountBio } from './professionalDescription';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

describe('descripción profesional del alta', () => {
  it('prefiere professional_description y si no, la bio', () => {
    expect(
      resolveAccountBio({
        professionalDescription: '  Arreglo caños  ',
        bio: 'otra',
        tradeFallback: 'oficio',
      }),
    ).toBe('Arreglo caños');
    expect(resolveAccountBio({ professionalDescription: '', bio: '  Desde la bio  ' })).toBe(
      'Desde la bio',
    );
    expect(resolveAccountBio({ bio: '', tradeFallback: 'Plomero: pérdidas' })).toBe(
      'Plomero: pérdidas',
    );
    expect(resolveAccountBio({ bio: '   ', professionalDescription: null })).toBeUndefined();
  });

  it('escribe las dos columnas con el mismo texto', () => {
    expect(professionalDescriptionColumns('  Hola, soy Ana.  ')).toEqual({
      professional_description: 'Hola, soy Ana.',
      bio: 'Hola, soy Ana.',
    });
  });

  it('el alta llama primero al RPC que escribe bio y professional_description', () => {
    const src = read('src/services/supabaseUser.ts');
    const start = src.indexOf('async function writeOwnProfessionalDescription');
    const fn = src.slice(start, start + 1800);
    const rpc = fn.indexOf("rpc('update_professional_description'");
    const direct = fn.indexOf(".from('profiles')");
    expect(rpc).toBeGreaterThan(0);
    expect(direct).toBeGreaterThan(rpc);
    expect(src).toContain('await writeOwnProfessionalDescription(supabase, userId, payload.bio');
    const editor = read('src/screens/account/WorkerABMScreen.tsx');
    expect(editor).toContain('const fromAccount = (user?.bio ?? \'\').trim()');
  });

  it('el INSERT del alta copia la bio a professional_description', () => {
    const sql = read('supabase/20261005_signup_professional_description.sql');
    expect(sql).toContain('professional_description');
    expect(sql).toContain('v_text');
    expect(sql).toContain('WHEN EXCLUDED.bio <> \'\' THEN EXCLUDED.bio');
    expect(sql).toContain('GRANT UPDATE (professional_description, bio)');
  });
});
