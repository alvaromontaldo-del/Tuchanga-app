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

describe('hide_pair_chats_if_done', () => {
  const body = functionBody(sql, 'hide_pair_chats_if_done');

  it('oculta el general solo si el par está terminado y el hilo de reclamo cuando el suyo cerró', () => {
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain('SET search_path = public');
    expect(body).toContain('ct.completed_by_worker_at IS NOT NULL');
    expect(body).toContain('ct.conformidad_aceptada IS TRUE');
    expect(body).toContain("ct.estado_pago = 'totalmente_pagado'");
    expect(body).toContain("ct.estado_trabajo = 'cancelado'");
    expect(body).toContain('ct.claim_marked_done_at IS NOT NULL');
    expect(body).toContain('ct.claim_resolved_at IS NOT NULL');
    expect(body).toContain("ct.claim_status = 'closed'");
    expect(body).toContain("ct.claim_status IN ('open', 'pending_approval')");
    expect(body).toContain('conv.contratacion_id IS NULL');
    expect(body).toContain('conv.contratacion_id IS NOT NULL');
    expect(body).toContain('NOT public.conversation_tiene_trabajo_vivo(conv.id)');
    expect(body).toContain('PERFORM public.hide_conversation_for_participants(c.id)');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM PUBLIC;',
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM anon;',
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM authenticated;',
    );
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION public.hide_pair_chats_if_done');
  });

  it('no recrea el ocultado ni las reglas de hilo que ya están en producción', () => {
    expect(sql).not.toContain('FUNCTION public.hide_conversation_for_participants');
    expect(sql).not.toContain('FUNCTION public.enforce_message_rules');
    expect(sql).not.toContain('FUNCTION public.find_or_create_conversation');
    expect(sql).not.toContain('FUNCTION public.iniciar_reclamo_garantia');
    expect(sql).not.toContain('FUNCTION public.crear_cotizacion');
    expect(sql).not.toContain('FUNCTION public.try_archive_chat_after_job_complete');
    expect(iniciar).toContain("RAISE EXCEPTION 'worker_on_leave'");
    expect(iniciar).toContain("RAISE EXCEPTION 'worker_unavailable'");
    expect(iniciar).toContain("RAISE EXCEPTION 'No se puede cotizar en un chat de reclamo'");
  });

  it('enganche el ocultado después del UPDATE de conformidad, pago y reclamo', () => {
    const finalizar = functionBody(sql, 'trabajador_finalizar_trabajo');
    const conformidad = functionBody(sql, 'cliente_responder_conformidad');
    const pago = functionBody(sql, 'trabajador_confirmar_recepcion_offline');
    const confirmar = functionBody(sql, 'confirmar_arreglo_garantia');
    const auto = functionBody(sql, 'auto_approve_stale_warranty_claims');

    expect(finalizar.indexOf('PERFORM public.hide_pair_chats_if_done')).toBeGreaterThan(
      finalizar.indexOf('conformidad_aceptada = true'),
    );
    expect(finalizar).toContain("'event', 'trabajo_finalizado'");
    expect(conformidad.indexOf('PERFORM public.hide_pair_chats_if_done')).toBeGreaterThan(
      conformidad.indexOf('conformidad_aceptada = true'),
    );
    expect(conformidad).toContain('conformidad_aceptada = false');
    expect(pago.indexOf('PERFORM public.hide_pair_chats_if_done')).toBeGreaterThan(
      pago.indexOf("estado_pago = 'totalmente_pagado'"),
    );
    expect(pago).toContain('PERFORM public.try_archive_chat_after_job_complete(p_contratacion_id)');
    expect(confirmar.indexOf('PERFORM public.hide_pair_chats_if_done')).toBeGreaterThan(
      confirmar.indexOf("claim_status = 'closed'"),
    );
    expect(confirmar).toContain(
      "'✅ El cliente confirmó el arreglo. Reclamo cerrado. La garantía de 30 días continúa sin reiniciarse.'",
    );
    expect(auto.indexOf('PERFORM public.hide_pair_chats_if_done(r.client_id, r.worker_id)')).toBeGreaterThan(
      auto.indexOf('claim_resolved_at = now()'),
    );
    expect(auto).toContain(
      "'✅ Reclamo de garantía cerrado automáticamente: el cliente no confirmó el arreglo en 72 horas. La garantía de 30 días sigue su curso normal.'",
    );
  });

  it('deja el backfill comentado y la lista no aplica la regla vieja de #55', () => {
    expect(sql).toContain('-- DO $$');
    expect(sql).toContain('--     PERFORM public.hide_pair_chats_if_done(pair.client_id, pair.worker_id);');
    expect(sql).not.toMatch(/^DO \$\$/m);
    expect(readFileSync(resolve(process.cwd(), 'src/services/chatSupabase.ts'), 'utf8')).not.toContain(
      'fetchClosedClaimChatIds',
    );
    expect(readFileSync(resolve(process.cwd(), 'src/services/inboxSyncSupabase.ts'), 'utf8')).not.toContain(
      'fetchClosedClaimChatIds',
    );
    expect(readFileSync(resolve(process.cwd(), 'src/screens/chat/ChatScreen.tsx'), 'utf8')).not.toContain(
      'fetchClosedClaimChatIds',
    );
  });
});
