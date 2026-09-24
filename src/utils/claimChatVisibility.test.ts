import { describe, expect, it } from 'vitest';
import {
  isChatClosedByClaimConformity,
  latestContratacionClosesChat,
} from './claimChatVisibility';

const closedClaim = {
  is_claim_open: false,
  claim_status: 'closed',
  claim_opened_at: '2026-09-01T12:00:00.000Z',
  claim_marked_done_at: '2026-09-02T12:00:00.000Z',
  claim_resolved_at: '2026-09-03T12:00:00.000Z',
  updated_at: '2026-09-03T12:00:00.000Z',
  created_at: '2026-08-01T12:00:00.000Z',
};

describe('isChatClosedByClaimConformity', () => {
  it('no cierra el chat si no hay reclamo', () => {
    expect(
      isChatClosedByClaimConformity({
        is_claim_open: false,
        claim_status: 'none',
        claim_opened_at: null,
        claim_marked_done_at: null,
        claim_resolved_at: null,
      }),
    ).toBe(false);
  });

  it('mantiene el chat mientras el reclamo está abierto', () => {
    expect(
      isChatClosedByClaimConformity({
        ...closedClaim,
        is_claim_open: true,
        claim_status: 'open',
        claim_marked_done_at: null,
        claim_resolved_at: null,
      }),
    ).toBe(false);
  });

  it('mantiene el chat si solo el profesional marcó el arreglo', () => {
    expect(
      isChatClosedByClaimConformity({
        ...closedClaim,
        is_claim_open: true,
        claim_status: 'pending_approval',
        claim_resolved_at: null,
      }),
    ).toBe(false);
  });

  it('cierra el chat cuando el reclamo empezó y los dos confirmaron', () => {
    expect(isChatClosedByClaimConformity(closedClaim)).toBe(true);
  });

  it('trata la autoaprobación a las 72 h como conformidad del cliente', () => {
    expect(isChatClosedByClaimConformity(closedClaim)).toBe(true);
  });
});

describe('latestContratacionClosesChat', () => {
  it('no cierra el hilo si hay una contratación más nueva sin reclamo cerrado', () => {
    expect(
      latestContratacionClosesChat([
        closedClaim,
        {
          is_claim_open: false,
          claim_status: 'none',
          claim_opened_at: null,
          claim_marked_done_at: null,
          claim_resolved_at: null,
          updated_at: '2026-09-10T12:00:00.000Z',
          created_at: '2026-09-10T12:00:00.000Z',
        },
      ]),
    ).toBe(false);
  });

  it('cierra el hilo si la contratación más reciente es el reclamo conformado', () => {
    expect(
      latestContratacionClosesChat([
        {
          is_claim_open: false,
          claim_status: 'none',
          updated_at: '2026-08-01T12:00:00.000Z',
        },
        closedClaim,
      ]),
    ).toBe(true);
  });
});
