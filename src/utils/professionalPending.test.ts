import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(__dirname, '../../supabase/20261005_professional_signup_pending.sql'),
  'utf8',
);

describe('alta profesional pendiente', () => {
  it('el listado deja de traducir “tiene oficios” a accepted', () => {
    const bad = "coverage_km, 0) > 0 THEN 'accepted'";
    expect(sql.split(bad).length - 1).toBe(1);
    expect(sql).toContain('EXECUTE replace(v_sql, v_bad, v_good)');
    expect(sql).toContain("coalesce(nullif(btrim(p.professional_status), ''), 'none')");
  });

  it('al validar el mail pide pending y no pisa un perfil ya aceptado', () => {
    expect(sql).toContain('PERFORM public.maybe_set_professional_pending(NEW.id)');
    expect(sql).toContain('NEW.email_confirmed_at IS NOT NULL');
  });

  it('el admin sigue pudiendo aprobar y rechazar', () => {
    expect(sql).toContain("professional_status = 'accepted'");
    expect(sql).toContain("professional_status = 'rejected'");
    expect(sql).toContain('PERFORM public._admin_require()');
    expect(sql).toContain('Tenés que indicar el motivo del rechazo.');
  });

  it('devuelve a pending la cuenta de prueba solo si nadie la revisó', () => {
    expect(sql).toContain('pedidos.lanegritasn@gmail.com');
    expect(sql).toContain('pedidos.lanegrita@gmail.com');
    expect(sql).toContain('p.professional_reviewed_by IS NULL');
    expect(sql).toContain("p.professional_status IN ('accepted', 'none')");
  });

  it('el alta en la app no escribe accepted', () => {
    const app = readFileSync(resolve(__dirname, '../services/supabaseUser.ts'), 'utf8');
    expect(app).toContain('trg_jobs_professional_pending');
    expect(app).not.toMatch(/professional_status:\s*'accepted'/);
  });
});
