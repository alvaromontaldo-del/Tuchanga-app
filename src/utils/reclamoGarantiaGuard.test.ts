import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

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
