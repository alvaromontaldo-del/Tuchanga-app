import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matriculaRechazoPushBody } from '../../supabase/functions/_shared/matriculaRechazoPush';

const FOTO = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('push de rechazo de matrícula (#77)', () => {
  it('arma la frase de la foto y la de la matrícula', () => {
    expect(
      matriculaRechazoPushBody({
        motivo: '  La foto   está cortada ',
        eventKey: `matricula:${USER}:${FOTO}:1760000000`,
      }),
    ).toBe(
      'Algunas fotos de la verificación de la matrícula fueron rechazadas por el siguiente motivo: La foto está cortada',
    );

    expect(
      matriculaRechazoPushBody({
        motivo: 'No coincide',
        kind: 'foto',
        eventKey: `matricula:${USER}:gas:1760000000`,
      }),
    ).toBe(
      'Algunas fotos de la verificación de la matrícula fueron rechazadas por el siguiente motivo: No coincide',
    );

    expect(
      matriculaRechazoPushBody({
        motivo: 'Número ilegible',
        eventKey: `matricula:${USER}:gas:1760000000`,
      }),
    ).toBe('Tu matricula fue rechazada por el siguiente motivo: Número ilegible');

    expect(
      matriculaRechazoPushBody({
        motivo: 'Documento vencido',
        kind: 'matricula',
        eventKey: `matricula:${USER}:${FOTO}:1760000000`,
      }),
    ).toBe('Tu matricula fue rechazada por el siguiente motivo: Documento vencido');

    expect(
      matriculaRechazoPushBody({
        motivo: 'Legajo incompleto',
        eventKey: `matricula:${USER}:1760000000`,
      }),
    ).toBe('Tu matricula fue rechazada por el siguiente motivo: Legajo incompleto');
  });

  it('la edge manda esa frase y el SQL no da EXECUTE a anon', () => {
    const edge = readFileSync('supabase/functions/push_on_matricula/index.ts', 'utf8');
    expect(edge).toContain('matriculaRechazoPushBody');
    expect(edge).toContain('body: pushBody');
    expect(edge).not.toContain('body: motivo');
    expect(edge).toContain('requireFunctionSecret');
    expect(edge).toContain('.select("expo_push_token")');
    expect(edge).toContain('matricula_verificada');

    const shared = readFileSync('supabase/functions/_shared/matriculaRechazoPush.ts', 'utf8');
    expect(shared).toContain(
      'Algunas fotos de la verificación de la matrícula fueron rechazadas por el siguiente motivo: ',
    );
    expect(shared).toContain('Tu matricula fue rechazada por el siguiente motivo: ');
    expect(shared).not.toContain('Una foto fue rechazada por el motivo: ');

    const antecedentes = readFileSync(
      'supabase/20261112_card_77_r5_push_texto.sql',
      'utf8',
    );
    expect(antecedentes).toContain(
      "v_body := 'La verificación de antecedentes penales fue rechazada por el siguiente motivo: ' || v_motivo",
    );
    expect(antecedentes).toContain("v_body := v_body || '.'");
    expect(antecedentes).toContain('notify_antecedentes_rechazo y notify_matricula_rechazo no se recrean');
    expect(antecedentes).toContain(
      'REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM PUBLIC',
    );
    expect(antecedentes).toContain(
      'REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM anon',
    );
    expect(antecedentes).toContain(
      'REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM authenticated',
    );
    expect(antecedentes).toContain(
      'REVOKE ALL ON FUNCTION public.antecedentes_rechazo_push_body(text) FROM service_role',
    );
    expect(antecedentes).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.antecedentes_rechazo_push_body\(text\)/,
    );
    expect(antecedentes).not.toMatch(/CREATE OR REPLACE FUNCTION public\.notify_antecedentes_rechazo/);
    expect(antecedentes).not.toMatch(/CREATE OR REPLACE FUNCTION public\.notify_matricula_rechazo/);

    const sql = readFileSync('supabase/20261111_card_77_push_rechazo.sql', 'utf8');
    expect(sql).toContain('notify_matricula_rechazo');
    expect(sql).toContain("'kind'");
    expect(sql).toContain("THEN 'foto'");
    expect(sql).toContain('invoke_vault_edge_webhook');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.notify_matricula_rechazo(uuid, text, text) FROM PUBLIC, anon, authenticated',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.notify_matricula_rechazo(uuid, text, text) TO service_role',
    );
    expect(sql).not.toMatch(/notify_matricula_rechazo\(uuid, text, text\)\s+TO\s+anon/);
    expect(sql).not.toMatch(/storage_paths/);
    expect(sql).not.toMatch(/\bnumero\b/);
  });
});
