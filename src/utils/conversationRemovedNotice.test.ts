import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_REMOVED_MESSAGE,
  jobClosesConversation,
  jobKeepsConversationVisible,
  shouldLeaveDeletedConversation,
  type ConversationJobSnapshot,
} from './conversationRemovedNotice';

const finished: ConversationJobSnapshot = {
  estado_trabajo: 'finalizado',
  estado_pago: 'totalmente_pagado',
  completed_by_worker_at: '2026-11-01T12:00:00.000Z',
  conformidad_aceptada: true,
  is_claim_open: false,
  claim_status: 'none',
};

const live: ConversationJobSnapshot = {
  estado_trabajo: 'en_curso',
  estado_pago: 'seña_pagada',
  is_claim_open: false,
  claim_status: 'none',
};

const openClaim: ConversationJobSnapshot = {
  estado_trabajo: 'finalizado',
  estado_pago: 'totalmente_pagado',
  completed_by_worker_at: '2026-10-01T12:00:00.000Z',
  conformidad_aceptada: true,
  is_claim_open: true,
  claim_status: 'open',
  claim_opened_at: '2026-11-02T12:00:00.000Z',
};

const pendingClaim: ConversationJobSnapshot = {
  ...openClaim,
  is_claim_open: true,
  claim_status: 'pending_approval',
  claim_marked_done_at: '2026-11-03T12:00:00.000Z',
};

const closedClaim: ConversationJobSnapshot = {
  estado_trabajo: 'finalizado',
  estado_pago: 'totalmente_pagado',
  completed_by_worker_at: '2026-10-01T12:00:00.000Z',
  conformidad_aceptada: true,
  is_claim_open: false,
  claim_status: 'closed',
  claim_opened_at: '2026-11-02T12:00:00.000Z',
  claim_marked_done_at: '2026-11-03T12:00:00.000Z',
  claim_resolved_at: '2026-11-04T12:00:00.000Z',
};

describe('jobKeepsConversationVisible', () => {
  it('mantiene el chat con trabajo en curso o reclamo abierto o pendiente', () => {
    expect(jobKeepsConversationVisible(live)).toBe(true);
    expect(jobKeepsConversationVisible(openClaim)).toBe(true);
    expect(jobKeepsConversationVisible(pendingClaim)).toBe(true);
    expect(jobKeepsConversationVisible({ estado_trabajo: 'pendiente_conformidad' })).toBe(true);
  });

  it('no mantiene un finalizado, cancelado o disputa sin reclamo vivo', () => {
    expect(jobKeepsConversationVisible(finished)).toBe(false);
    expect(jobKeepsConversationVisible({ estado_trabajo: 'cancelado' })).toBe(false);
    expect(jobKeepsConversationVisible({ estado_trabajo: 'disputa', is_claim_open: false })).toBe(
      false,
    );
  });
});

describe('jobClosesConversation', () => {
  it('cierra con conformidad de las dos partes y pago completo', () => {
    expect(jobClosesConversation(finished)).toBe(true);
  });

  it('no cierra si falta el pago o la conformidad', () => {
    expect(jobClosesConversation({ ...finished, estado_pago: 'seña_pagada' })).toBe(false);
    expect(jobClosesConversation({ ...finished, conformidad_aceptada: false })).toBe(false);
    expect(jobClosesConversation({ ...finished, completed_by_worker_at: null })).toBe(false);
  });

  it('cierra el reclamo cuando el profesional marcó el arreglo y el cliente confirmó', () => {
    expect(jobClosesConversation(closedClaim)).toBe(true);
    expect(jobClosesConversation(pendingClaim)).toBe(false);
    expect(jobClosesConversation(openClaim)).toBe(false);
  });
});

describe('shouldLeaveDeletedConversation', () => {
  it('no sale si el hilo sigue en la lista, o si el aviso ya se mostró', () => {
    expect(
      shouldLeaveDeletedConversation({
        removed: false,
        linkedJobs: [finished],
        pairJobs: [finished],
        alreadyAnnounced: false,
      }),
    ).toBe(false);
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        linkedJobs: [finished],
        pairJobs: [finished],
        alreadyAnnounced: true,
      }),
    ).toBe(false);
  });

  it('sale del general cuando el trabajo terminó y el servidor lo ocultó', () => {
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        claimContratacionId: null,
        linkedJobs: [finished],
        pairJobs: [finished],
        alreadyAnnounced: false,
      }),
    ).toBe(true);
  });

  it('no sale del general si queda otro trabajo vivo o un reclamo abierto', () => {
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        linkedJobs: [finished],
        pairJobs: [finished, live],
        alreadyAnnounced: false,
      }),
    ).toBe(false);
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        linkedJobs: [finished, openClaim],
        pairJobs: [finished, openClaim],
        alreadyAnnounced: false,
      }),
    ).toBe(false);
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        linkedJobs: [pendingClaim],
        pairJobs: [pendingClaim],
        alreadyAnnounced: false,
      }),
    ).toBe(false);
  });

  it('sale del hilo de reclamo cerrado aunque el par tenga otro trabajo vivo', () => {
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        claimContratacionId: 'job-claim',
        linkedJobs: [closedClaim],
        pairJobs: [closedClaim, live],
        alreadyAnnounced: false,
      }),
    ).toBe(true);
  });

  it('no avisa un borrado manual de un chat que no terminó el trabajo', () => {
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        linkedJobs: [live],
        pairJobs: [live],
        alreadyAnnounced: false,
      }),
    ).toBe(false);
    expect(
      shouldLeaveDeletedConversation({
        removed: true,
        linkedJobs: [],
        pairJobs: [{ estado_trabajo: 'cancelado' }],
        alreadyAnnounced: false,
      }),
    ).toBe(false);
  });
});

describe('pantallas', () => {
  it('el chat y el detalle vuelven a la lista con el aviso, una sola vez', () => {
    const hook = readFileSync('src/hooks/useLeaveRemovedConversation.ts', 'utf8');
    const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
    const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
    expect(CONVERSATION_REMOVED_MESSAGE).toBe(
      'La conversación fue eliminada porque el trabajo finalizó.',
    );
    expect(hook).toContain('CONVERSATION_REMOVED_MESSAGE');
    expect(hook).toContain('shouldLeaveDeletedConversation(');
    expect(hook).toContain('ConversationsList');
    expect(hook).toContain('alreadyAnnounced');
    expect(chat).toContain('useLeaveRemovedConversation(');
    expect(chat).toContain('suppressRemovedConversationNotice');
    expect(chat).toContain('recheckRemovedConversation');
    expect(detail).toContain('useLeaveRemovedConversation(');
    expect(detail).toContain('onlyAfterSeenVisible: true');
    expect(detail).toContain("recheckRemovedConversation('action')");
    expect(chat).not.toContain('onlyAfterSeenVisible');
  });
});
