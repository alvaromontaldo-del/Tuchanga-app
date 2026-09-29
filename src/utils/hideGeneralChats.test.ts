import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260929220000_hide_general_chat_when_all_claims_closed.sql',
  ),
  'utf8',
);

const iniciar = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260925223000_iniciar_reclamo_garantia.sql'),
  'utf8',
);

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf('\nCREATE ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe('hide_general_chats_if_all_claims_closed', () => {
  const body = functionBody(sql, 'hide_general_chats_if_all_claims_closed');

  it('es security definer, no es RPC de cliente y oculta solo el hilo general', () => {
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain('SET search_path = public');
    expect(body).toContain('conv.contratacion_id IS NULL');
    expect(body).toContain('conv.deleted_at IS NULL');
    expect(body).toContain('ct.claim_opened_at IS NOT NULL');
    expect(body).toContain('ct.is_claim_open = false');
    expect(body).toContain("ct.claim_status = 'closed'");
    expect(body).toContain('NOT public.conversation_tiene_trabajo_vivo(c.id)');
    expect(body).toContain('PERFORM public.hide_conversation_for_participants(c.id)');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.hide_general_chats_if_all_claims_closed(uuid, uuid) FROM PUBLIC;',
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.hide_general_chats_if_all_claims_closed(uuid, uuid) FROM anon;',
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.hide_general_chats_if_all_claims_closed(uuid, uuid) FROM authenticated;',
    );
    expect(sql).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.hide_general_chats_if_all_claims_closed',
    );
  });

  it('no recrea el ocultado ni las reglas de hilo que ya están en producción', () => {
    expect(sql).not.toContain('FUNCTION public.hide_conversation_for_participants');
    expect(sql).not.toContain('FUNCTION public.enforce_message_rules');
    expect(sql).not.toContain('FUNCTION public.find_or_create_conversation');
    expect(sql).not.toContain('FUNCTION public.iniciar_reclamo_garantia');
    expect(sql).not.toContain('FUNCTION public.crear_cotizacion');
    expect(iniciar).toContain("RAISE EXCEPTION 'worker_on_leave'");
    expect(iniciar).toContain("RAISE EXCEPTION 'worker_unavailable'");
    expect(iniciar).toContain("RAISE EXCEPTION 'No se puede cotizar en un chat de reclamo'");
  });

  it('confirma y autoaprueba llaman al par después del UPDATE, con el aviso de producción', () => {
    const confirmar = functionBody(sql, 'confirmar_arreglo_garantia');
    const auto = functionBody(sql, 'auto_approve_stale_warranty_claims');
    const confirmarUpdate = confirmar.indexOf('claim_status = \'closed\'');
    const confirmarHide = confirmar.indexOf(
      'PERFORM public.hide_general_chats_if_all_claims_closed(v_row.client_id, v_row.worker_id);',
    );
    const confirmarNotice = confirmar.indexOf('PERFORM public._chat_notify_contratacion');
    expect(confirmarUpdate).toBeGreaterThan(-1);
    expect(confirmarHide).toBeGreaterThan(confirmarUpdate);
    expect(confirmarNotice).toBeGreaterThan(confirmarHide);
    expect(confirmar).toContain(
      "'✅ El cliente confirmó el arreglo. Reclamo cerrado. La garantía de 30 días continúa sin reiniciarse.'",
    );
    expect(confirmar).toContain("RAISE EXCEPTION 'solo_cliente_puede_confirmar_arreglo'");
    expect(confirmar).toContain("RAISE EXCEPTION 'no_hay_arreglo_pendiente_de_aprobacion'");

    const autoUpdate = auto.indexOf('claim_resolved_at = now()');
    const autoHide = auto.indexOf(
      'PERFORM public.hide_general_chats_if_all_claims_closed(r.client_id, r.worker_id);',
    );
    expect(auto).toContain('c.client_id, c.worker_id');
    expect(auto).toContain("c.claim_marked_done_at <= now() - interval '72 hours'");
    expect(autoHide).toBeGreaterThan(autoUpdate);
    expect(auto).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(auto).toContain(
      "'✅ Reclamo de garantía cerrado automáticamente: el cliente no confirmó el arreglo en 72 horas. La garantía de 30 días sigue su curso normal.'",
    );
  });

  it('deja el backfill comentado, un par distinto por vez', () => {
    expect(sql).toContain('-- DO $$');
    expect(sql).toContain(
      '--     PERFORM public.hide_general_chats_if_all_claims_closed(pair.client_id, pair.worker_id);',
    );
    expect(sql).toContain('--     SELECT DISTINCT ct.client_id, ct.worker_id');
    expect(sql).not.toMatch(/^DO \$\$/m);
  });
});
