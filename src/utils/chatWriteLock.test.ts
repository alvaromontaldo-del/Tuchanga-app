import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  claimThreadShouldLock,
  generalChatShouldLock,
  isChatWriteLocked,
  type ChatLockJob,
} from './chatWriteLock';

function job(partial: Partial<ChatLockJob> & Pick<ChatLockJob, 'id'>): ChatLockJob {
  return {
    conversationId: 'conv-general',
    estado_trabajo: 'finalizado',
    estado_pago: 'totalmente_pagado',
    completed_by_worker_at: '2026-11-01T12:00:00.000Z',
    conformidad_aceptada: true,
    is_claim_open: false,
    claim_status: 'none',
    claim_opened_at: null,
    claim_marked_done_at: null,
    claim_resolved_at: null,
    ...partial,
  };
}

describe('bloqueo del chat tras las dos conformidades', () => {
  it('bloquea cuando el trabajo está finalizado, conforme y pago', () => {
    expect(generalChatShouldLock([job({ id: 'a' })])).toBe(true);
  });

  it('no bloquea si falta el pago recibido o la conformidad', () => {
    expect(
      generalChatShouldLock([job({ id: 'a', estado_pago: 'seña_pagada' })]),
    ).toBe(false);
    expect(
      generalChatShouldLock([job({ id: 'a', conformidad_aceptada: false })]),
    ).toBe(false);
    expect(
      generalChatShouldLock([job({ id: 'a', completed_by_worker_at: null })]),
    ).toBe(false);
  });

  it('no bloquea si queda otro trabajo vivo o un reclamo abierto del par', () => {
    expect(
      generalChatShouldLock([
        job({ id: 'cerrado' }),
        job({ id: 'vivo', estado_trabajo: 'en_curso', estado_pago: 'seña_pagada', conformidad_aceptada: null, completed_by_worker_at: null }),
      ]),
    ).toBe(false);
    expect(
      generalChatShouldLock([
        job({ id: 'cerrado' }),
        job({
          id: 'reclamo',
          is_claim_open: true,
          claim_status: 'open',
          claim_opened_at: '2026-11-02T12:00:00.000Z',
        }),
      ]),
    ).toBe(false);
    expect(
      generalChatShouldLock([job({ id: 'disputa', estado_trabajo: 'disputa' })]),
    ).toBe(false);
  });

  it('un cancelado no alcanza para bloquear, pero no impide el cierre de otro', () => {
    expect(generalChatShouldLock([job({ id: 'x', estado_trabajo: 'cancelado', conformidad_aceptada: null, completed_by_worker_at: null })])).toBe(false);
    expect(
      generalChatShouldLock([
        job({ id: 'ok' }),
        job({ id: 'x', estado_trabajo: 'cancelado', conformidad_aceptada: null, completed_by_worker_at: null }),
      ]),
    ).toBe(true);
  });

  it('el hilo de reclamo se bloquea al cerrar y no si ese hilo sigue vivo', () => {
    const closed = job({
      id: 'claim-job',
      conversationId: 'conv-claim',
      claim_opened_at: '2026-11-01T12:00:00.000Z',
      claim_marked_done_at: '2026-11-02T12:00:00.000Z',
      claim_resolved_at: '2026-11-02T13:00:00.000Z',
      claim_status: 'closed',
      is_claim_open: false,
    });
    expect(
      claimThreadShouldLock({
        conversationId: 'conv-claim',
        claimContratacionId: 'claim-job',
        jobs: [closed],
      }),
    ).toBe(true);
    expect(
      claimThreadShouldLock({
        conversationId: 'conv-claim',
        claimContratacionId: 'claim-job',
        jobs: [
          closed,
          job({
            id: 'otro',
            conversationId: 'conv-claim',
            estado_trabajo: 'en_curso',
            conformidad_aceptada: null,
            completed_by_worker_at: null,
          }),
        ],
      }),
    ).toBe(false);
    expect(
      isChatWriteLocked({
        jobsLoaded: false,
        conversationId: 'conv-general',
        claimContratacionId: null,
        jobs: [job({ id: 'a' })],
      }),
    ).toBe(false);
  });
});

describe('SQL del bloqueo y del precio de ítem', () => {
  const sql = readFileSync('supabase/20261111_chatlock_y_precio_item.sql', 'utf8');

  it('bloquea en el servidor, guarda el timestamp y borra a los 7 días o con la reseña', () => {
    expect(sql).toContain('write_locked_at');
    expect(sql).toContain('conversation_should_write_lock');
    expect(sql).toContain("RAISE EXCEPTION 'chat_bloqueado'");
    expect(sql).toContain('purge_locked_chats_without_review');
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain('worker_reviews');
    expect(sql).toContain('hide_conversation_for_participants');
    expect(sql).toContain('public.conversation_tiene_trabajo_vivo(p_conversation_id)');
    expect(sql).toContain("ct.claim_status IN ('open', 'pending_approval')");
    expect(sql).toContain('cron.schedule');
    expect(sql).toContain('chat_bloqueado_sin_resena_7d');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.\w+[\s\S]*TO anon/);
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.conversation_should_write_lock(uuid) FROM anon');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.hide_pair_chats_if_done(uuid, uuid) FROM anon');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.purge_locked_chats_without_review() FROM anon');
  });

  it('permite el precio del ítem en variant_index 0 y mantiene las marcas 1..3', () => {
    expect(sql).toContain('CHECK (variant_index BETWEEN 0 AND 3)');
    expect(sql).toContain('variant_index 0');
    expect(sql).not.toContain('TO anon');
  });

  it('la reseña que cierra es de este chat, no cualquier reseña del par', () => {
    const start = sql.indexOf('FUNCTION public.chat_has_closing_review');
    const end = sql.indexOf('FUNCTION public.sync_conversation_chat_lock');
    const body = sql.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('wr.conversation_id = conv.id');
    expect(body).toContain('wr.job_id = conv.contratacion_id');
    expect(body).toContain('ct.conversation_id = conv.id');
    expect(body).toContain('JOIN public.contrataciones ct ON ct.id = wr.job_id');
    expect(body).toContain("ct.estado_trabajo = 'finalizado'");
    expect(body).toContain("ct.estado_pago = 'totalmente_pagado'");
    expect(body).toContain("ct.claim_status = 'closed'");
    expect(body).not.toContain('ct.client_id');
    expect(body).not.toContain('ct.worker_id');
    expect(body).not.toContain('conv.cliente_id');
    expect(body).not.toContain('conv.trabajador_id');
  });

  it('chat_pair_ready repite la condición viva de hide_pair_chats_if_done', () => {
    const live = readFileSync(
      'supabase/migrations/20260929220000_hide_general_chat_when_all_claims_closed.sql',
      'utf8',
    );
    const liveStart = live.indexOf('SELECT');
    const liveEnd = live.indexOf('INTO v_pair_ready');
    const liveReady = live.slice(liveStart, liveEnd);
    const readyStart = sql.indexOf('FUNCTION public.chat_pair_ready');
    const readyEnd = sql.indexOf('FUNCTION public.conversation_should_write_lock');
    const ready = sql.slice(readyStart, readyEnd);
    for (const needle of [
      "ct.estado_trabajo = 'finalizado'",
      'ct.completed_by_worker_at IS NOT NULL',
      'ct.conformidad_aceptada IS TRUE',
      "ct.estado_pago = 'totalmente_pagado'",
      'NOT ct.is_claim_open',
      "ct.claim_status NOT IN ('open', 'pending_approval')",
      'ct.claim_opened_at IS NOT NULL',
      'ct.claim_marked_done_at IS NOT NULL',
      'ct.claim_resolved_at IS NOT NULL',
      "ct.claim_status = 'closed'",
      "ct.estado_trabajo = 'cancelado'",
      "ct.claim_status IN ('open', 'pending_approval')",
    ]) {
      expect(liveReady).toContain(needle);
      expect(ready).toContain(needle);
    }
  });

  it('reprograma el cron de 7 días como postgres', () => {
    expect(sql).toContain("cron.unschedule('chat_bloqueado_sin_resena_7d')");
    expect(sql).toContain("username = 'postgres'");
    expect(sql).toContain('chat_bloqueado_sin_resena_7d');
  });
});
