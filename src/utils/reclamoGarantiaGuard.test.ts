import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('eas-update no interpola el mensaje del commit', () => {
  const yml = readFileSync(resolve(root, '.github/workflows/eas-update.yml'), 'utf8');

  it('pasa el mensaje por env y lo cita en el comando', () => {
    expect(yml).toContain('COMMIT_MSG: ${{ github.event.head_commit.message }}');
    expect(yml).toContain('--branch preview');
    expect(yml).toContain('--environment preview');
    expect(yml).toContain('--non-interactive');
    expect(yml).toContain('--message "$COMMIT_MSG"');
    expect(yml).not.toMatch(/--message\s+"\$\{\{/);
    expect(yml).toContain('[ -z "$COMMIT_MSG" ]');
    expect(yml).toContain('COMMIT_MSG="EAS Update"');
  });
});

describe('migración iniciar_reclamo_garantia', () => {
  const sql = readFileSync(
    resolve(root, 'supabase/migrations/20260925223000_iniciar_reclamo_garantia.sql'),
    'utf8',
  );

  it('sigue siendo security definer y revoca anon', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.iniciar_reclamo_garantia(uuid) FROM anon;',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.iniciar_reclamo_garantia(uuid) TO authenticated, service_role;',
    );
  });

  it('no borra a ciegas el otro chat activo del par', () => {
    expect(sql).not.toContain('SET deleted_at = now()');
    expect(sql).not.toContain("RAISE EXCEPTION 'No hay chat para este trabajo'");
    expect(sql).toContain('hide_conversation_for_participants');
    expect(sql).toContain('DELETE FROM public.conversation_hides');
    expect(sql).toContain('INSERT INTO public.conversations');
  });
});
