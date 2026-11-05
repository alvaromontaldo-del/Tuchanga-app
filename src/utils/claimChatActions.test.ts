import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  claimChatActions,
  conversationBlocksNewMaterials,
  jobHasOpenWarrantyClaim,
  jobUsesWarrantyRevisitAgenda,
  MATERIALS_CLAIM_BLOCKED_MESSAGE,
  type ClaimChatJob,
} from './claimChatActions';

function job(partial: Partial<ClaimChatJob> & Pick<ClaimChatJob, 'id' | 'estadoTrabajo'>): ClaimChatJob {
  return {
    isClaimOpen: false,
    claimStatus: 'none',
    ...partial,
  };
}

const claimOpen = job({
  id: 'a',
  estadoTrabajo: 'finalizado',
  isClaimOpen: true,
  claimStatus: 'open',
});

const claimPending = job({
  id: 'a',
  estadoTrabajo: 'finalizado',
  isClaimOpen: true,
  claimStatus: 'pending_approval',
});

const claimClosed = job({
  id: 'a',
  estadoTrabajo: 'finalizado',
  isClaimOpen: false,
  claimStatus: 'closed',
});

const live = job({ id: 'b', estadoTrabajo: 'en_curso' });
const quoting = job({ id: 'c', estadoTrabajo: 'precio_cotizado' });

describe('acciones del chat por trabajo reclamado', () => {
  it('sin reclamo deja Cotizar y Materiales, y no fuerza Agenda', () => {
    const plain = job({ id: 'a', estadoTrabajo: 'en_curso' });
    expect(jobHasOpenWarrantyClaim(plain)).toBe(false);
    expect(claimChatActions({ focusJobId: 'a', jobs: [plain] })).toEqual({
      focusClaimOpen: false,
      otherLiveJobKeepsActions: false,
      blockOwnQuoteAndMaterials: false,
      showAgenda: false,
    });
    expect(conversationBlocksNewMaterials([plain])).toBe(false);
    expect(conversationBlocksNewMaterials([])).toBe(false);
  });

  it('un reclamo abierto o pendiente deja solo Agenda en ese trabajo', () => {
    for (const row of [claimOpen, claimPending]) {
      expect(jobUsesWarrantyRevisitAgenda(row)).toBe(true);
      expect(claimChatActions({ focusJobId: row.id, jobs: [row] })).toEqual({
        focusClaimOpen: true,
        otherLiveJobKeepsActions: false,
        blockOwnQuoteAndMaterials: true,
        showAgenda: true,
      });
      expect(conversationBlocksNewMaterials([row])).toBe(true);
    }
    expect(
      jobHasOpenWarrantyClaim({ isClaimOpen: false, claimStatus: 'open' }),
    ).toBe(true);
    expect(
      jobUsesWarrantyRevisitAgenda({
        estadoTrabajo: 'en_curso',
        isClaimOpen: true,
        claimStatus: 'open',
      }),
    ).toBe(false);
  });

  it('otro trabajo vivo del mismo hilo conserva Materiales y la cotización', () => {
    const decision = claimChatActions({
      focusJobId: 'a',
      jobs: [claimOpen, live, quoting],
    });
    expect(decision.blockOwnQuoteAndMaterials).toBe(false);
    expect(decision.otherLiveJobKeepsActions).toBe(true);
    expect(decision.showAgenda).toBe(true);
    expect(conversationBlocksNewMaterials([claimOpen, live])).toBe(false);
    expect(conversationBlocksNewMaterials([claimOpen, quoting])).toBe(false);

    const focusedOnLive = claimChatActions({
      focusJobId: 'b',
      jobs: [claimOpen, live],
    });
    expect(focusedOnLive).toEqual({
      focusClaimOpen: false,
      otherLiveJobKeepsActions: false,
      blockOwnQuoteAndMaterials: false,
      showAgenda: false,
    });
    expect(conversationBlocksNewMaterials([claimOpen, live])).toBe(false);
  });

  it('al cerrar el reclamo se restablecen las acciones de ese trabajo', () => {
    expect(jobHasOpenWarrantyClaim(claimClosed)).toBe(false);
    expect(jobUsesWarrantyRevisitAgenda(claimClosed)).toBe(false);
    expect(claimChatActions({ focusJobId: 'a', jobs: [claimClosed] })).toEqual({
      focusClaimOpen: false,
      otherLiveJobKeepsActions: false,
      blockOwnQuoteAndMaterials: false,
      showAgenda: false,
    });
    expect(conversationBlocksNewMaterials([claimClosed, live])).toBe(false);
    expect(conversationBlocksNewMaterials([claimClosed])).toBe(false);
  });

  it('una disputa no se trata como reclamo de garantía', () => {
    const disputa = job({ id: 'd', estadoTrabajo: 'disputa' });
    expect(claimChatActions({ focusJobId: 'd', jobs: [disputa] }).blockOwnQuoteAndMaterials).toBe(
      false,
    );
    expect(conversationBlocksNewMaterials([disputa])).toBe(false);
    expect(conversationBlocksNewMaterials([claimOpen, disputa])).toBe(true);
  });
});

describe('la UI usa el criterio por trabajo y no apaga el resto del chat', () => {
  const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
  const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');
  const materials = readFileSync('src/services/materialRequestsSupabase.ts', 'utf8');
  const agenda = readFileSync('src/components/servicios/AgendaOpcionesCliente.tsx', 'utf8');

  it('oculta Materiales y la cotización nueva solo con el bloqueo de ese trabajo', () => {
    expect(chat).toContain('claimChatActions(');
    expect(chat).toContain('conversationJobsReady');
    expect(chat).toContain(
      "participants?.myRole === 'trabajador' && !chatBlocked && !claimLocksOwnActions",
    );
    expect(chat).toContain('!claimLocksOwnActions && q.status === \'pending\'');
    expect(chat).toContain('claimLocksOwnActions');
    expect(materials).toContain('conversationBlocksNewMaterials');
    expect(materials).toContain('MATERIALS_CLAIM_BLOCKED_MESSAGE');
    expect(MATERIALS_CLAIM_BLOCKED_MESSAGE).toMatch(/Agenda/);
    expect(materials).toContain('conversationAllowsMaterialsList');
  });

  it('ofrece Agenda de la revisita y no el rechazo que el servidor no acepta', () => {
    expect(chat).toContain('claimAgenda');
    expect(chat).toContain('coordinar la revisión de la garantía');
    expect(chat).toContain('onReject={claimAgenda ? undefined : handleRejectAgenda}');
    expect(chat).toContain('jobUsesWarrantyRevisitAgenda');
    expect(detail).toContain('jobUsesWarrantyRevisitAgenda');
    expect(detail).toContain("estado_trabajo === 'precio_aceptado'");
    expect(detail).toContain('Proponer disponibilidad (hasta 5)');
    expect(agenda).toContain('onReject ? (');
    expect(agenda).toContain('Prefiero otras fechas');
  });

  it('deja el chat, la reparación, la conformidad, la disputa y el encabezado', () => {
    expect(chat).toContain('showWorkerDisputaBar');
    expect(chat).toContain('showClientConformidadBar');
    expect(chat).toContain('trabajadorMarcarTrabajoReparado');
    expect(chat).toContain('showClientDisputaBar');
    expect(chat).not.toContain('marcar_arreglo_garantia_terminado');
    expect(chat).toContain("Platform.OS === 'ios' ? 48 : 0");
    expect(chat).toContain('styles.headerDistanceRow');
    expect(chat).toContain('>Materiales<');
    expect(chat).toContain('{quoteChip.label}');
    expect(chat).toContain('<Text style={styles.payBtnText}>Agenda</Text>');
    const header = chat.slice(chat.indexOf('<View style={styles.header}>'), chat.indexOf('<KeyboardAvoidingView'));
    expect(header.indexOf('styles.headerTopRow')).toBeLessThan(header.indexOf('styles.headerDistanceRow'));
    expect(header.split('styles.headerTopRow').length - 1).toBe(1);
  });
});
