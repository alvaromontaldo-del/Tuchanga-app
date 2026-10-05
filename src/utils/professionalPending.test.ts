import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(__dirname, '../../supabase/20261005_professional_signup_pending.sql'),
  'utf8',
);

describe('alta profesional pendiente', () => {
  it('el listado devuelve professional_status real, sin traducir oficios a accepted', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.admin_list_users');
    expect(sql).toContain("ELSE coalesce(nullif(btrim(p.professional_status), ''), 'none')");
    expect(sql).toContain("WHEN p.professional_deactivated_at IS NOT NULL THEN 'deactivated'");
    expect(sql).not.toContain("THEN 'accepted'");
    expect(sql).not.toContain('EXECUTE replace');
  });

  it('al validar el mail pide pending y no pisa un perfil ya aceptado', () => {
    expect(sql).toContain('PERFORM public.maybe_set_professional_pending(NEW.id)');
    expect(sql).toContain('NEW.email_confirmed_at IS NOT NULL');
    expect(sql).toContain("IF v_status IN ('accepted', 'pending', 'paused') THEN");
    expect(sql).toContain("professional_status = 'pending'");
    expect(sql).toContain("AND professional_status IN ('none', 'rejected', 'deactivated')");
  });

  it('el admin sigue pudiendo aprobar y rechazar', () => {
    expect(sql).toContain("professional_status = 'accepted'");
    expect(sql).toContain("professional_status = 'rejected'");
    expect(sql).toContain('professional_reviewed_at = now()');
    expect(sql).toContain('professional_reviewed_by = auth.uid()');
    expect(sql).toContain('professional_rejection_reason = v_reason');
    expect(sql).toContain('PERFORM public._admin_require()');
    expect(sql).toContain('Tenés que indicar el motivo del rechazo.');
    expect(sql).not.toContain('queda activo al guardar oficios');
  });

  it('la búsqueda pública y la del cliente solo aceptan accepted', () => {
    expect(sql).toContain("professional_status = ''accepted''");
    expect(sql).toContain('search_workers_public');
    expect(sql).toContain('search_workers_for_client');
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
