import { describe, expect, it } from 'vitest';
import {
  allLinkedJobsClosedWithoutOpenClaim,
  chatClosedByAllClaimsConformity,
  isChatClosedByClaimConformity,
} from './claimChatVisibility';

const closedClaim = {
  estado_trabajo: 'finalizado',
  is_claim_open: false,
  claim_status: 'closed',
  claim_opened_at: '2026-09-01T12:00:00.000Z',
  claim_marked_done_at: '2026-09-02T12:00:00.000Z',
  claim_resolved_at: '2026-09-03T12:00:00.000Z',
  updated_at: '2026-09-03T12:00:00.000Z',
  created_at: '2026-08-01T12:00:00.000Z',
};

const openClaim = {
  estado_trabajo: 'finalizado',
  is_claim_open: true,
  claim_status: 'open',
  claim_opened_at: '2026-09-10T12:00:00.000Z',
  claim_marked_done_at: null,
  claim_resolved_at: null,
};

const pendingClaim = {
  estado_trabajo: 'finalizado',
  is_claim_open: true,
  claim_status: 'pending_approval',
  claim_opened_at: '2026-09-24T12:00:00.000Z',
  claim_marked_done_at: '2026-09-25T12:00:00.000Z',
  claim_resolved_at: null,
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
    expect(isChatClosedByClaimConformity(openClaim)).toBe(false);
  });

  it('mantiene el chat si solo el profesional marcó el arreglo', () => {
    expect(isChatClosedByClaimConformity(pendingClaim)).toBe(false);
  });

  it('cierra el chat cuando el reclamo empezó y los dos confirmaron', () => {
    expect(isChatClosedByClaimConformity(closedClaim)).toBe(true);
  });

  it('trata la autoaprobación a las 72 h como conformidad del cliente', () => {
    expect(isChatClosedByClaimConformity(closedClaim)).toBe(true);
  });
});

describe('allLinkedJobsClosedWithoutOpenClaim', () => {
  it('no oculta un hilo sin contrataciones', () => {
    expect(allLinkedJobsClosedWithoutOpenClaim([])).toBe(false);
  });

  it('no oculta si alguna contratación sigue en curso', () => {
    expect(
      allLinkedJobsClosedWithoutOpenClaim([
        closedClaim,
        { estado_trabajo: 'en_curso', is_claim_open: false, claim_status: 'none' },
      ]),
    ).toBe(false);
  });

  it('no oculta el chat 3cef mientras quede un reclamo abierto o pendiente', () => {
    const rows = [closedClaim, openClaim, pendingClaim];
    expect(allLinkedJobsClosedWithoutOpenClaim(rows)).toBe(false);
    expect(chatClosedByAllClaimsConformity(rows)).toBe(false);
  });

  it('cerrar uno de tres reclamos no oculta ni bloquea el hilo del que sigue abierto', () => {
    const stillOpen = [closedClaim, openClaim, { ...closedClaim, claim_opened_at: '2026-09-04T12:00:00.000Z' }];
    expect(allLinkedJobsClosedWithoutOpenClaim(stillOpen)).toBe(false);
    expect(chatClosedByAllClaimsConformity([openClaim])).toBe(false);
    expect(chatClosedByAllClaimsConformity([closedClaim])).toBe(true);
  });

  it('oculta el hilo si hubo reclamo, todos conformes, y el resto está cerrado', () => {
    const rows = [
      closedClaim,
      { estado_trabajo: 'finalizado', is_claim_open: false, claim_status: 'none' },
      { estado_trabajo: 'cancelado', is_claim_open: false, claim_status: 'none' },
    ];
    expect(chatClosedByAllClaimsConformity(rows)).toBe(true);
  });

  it('un trabajo finalizado sin reclamo no se oculta', () => {
    const rows = [{ estado_trabajo: 'finalizado', is_claim_open: false, claim_status: 'none' }];
    expect(allLinkedJobsClosedWithoutOpenClaim(rows)).toBe(true);
    expect(chatClosedByAllClaimsConformity(rows)).toBe(false);
  });

  it('no oculta si un reclamo iniciado no llegó a conformidad, aunque otro sí', () => {
    expect(
      chatClosedByAllClaimsConformity([
        closedClaim,
        {
          estado_trabajo: 'finalizado',
          is_claim_open: false,
          claim_status: 'none',
          claim_opened_at: '2026-09-04T12:00:00.000Z',
          claim_marked_done_at: null,
          claim_resolved_at: null,
        },
      ]),
    ).toBe(false);
  });

  it('no oculta un reclamo conforme si otra contratación sigue en curso', () => {
    expect(
      chatClosedByAllClaimsConformity([
        closedClaim,
        { estado_trabajo: 'en_curso', is_claim_open: false, claim_status: 'none' },
      ]),
    ).toBe(false);
  });
});
