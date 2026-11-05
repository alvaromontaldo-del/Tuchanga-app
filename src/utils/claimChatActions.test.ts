import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  claimChatActions,
  conversationBlocksNewMaterials,
  formatWarrantyRevisitConfirmed,
  jobHasOpenWarrantyClaim,
  jobUsesWarrantyRevisitAgenda,
  MATERIALS_CLAIM_BLOCKED_MESSAGE,
  warrantyRevisitPhase,
  type ClaimChatJob,
  type WarrantyRevisitOption,
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

  it('ofrece Agenda de la revisita y el cliente puede rechazar las propuestas', () => {
    expect(chat).toContain('claimAgenda');
    expect(chat).toContain('coordinar la revisión de la garantía');
    expect(chat).toContain('onReject={handleRejectAgenda}');
    expect(chat).not.toContain('claimAgenda ? undefined');
    expect(chat).toContain('rechazarDisponibilidad');
    expect(chat).toContain('jobUsesWarrantyRevisitAgenda');
    expect(detail).toContain('jobUsesWarrantyRevisitAgenda');
    expect(detail).toContain("estado_trabajo === 'precio_aceptado'");
    expect(detail).toContain('Proponer disponibilidad (hasta 5)');
    expect(agenda).toContain('Prefiero otras fechas');
    expect(agenda).not.toContain('onReject ? (');
    expect(readFileSync('src/utils/claimChatActions.ts', 'utf8')).not.toContain(
      'sigue exigiendo `precio_aceptado`',
    );
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

function option(partial: Partial<WarrantyRevisitOption> & Pick<WarrantyRevisitOption, 'id' | 'estado'>): WarrantyRevisitOption {
  return {
    fechaTrabajo: '2026-10-02',
    horaInicio: '09:00:00',
    horaFin: '11:00:00',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...partial,
  };
}

const claimBase = {
  estadoTrabajo: 'finalizado',
  isClaimOpen: true,
  claimStatus: 'open',
  claimOpenedAt: '2026-10-05T15:00:00.000Z',
  fechaTrabajo: '2026-09-12',
  horaInicio: '08:00:00',
  horaFin: '10:00:00',
};

describe('revisita confirmada', () => {
  it('muestra el horario si la opción aceptada después del reclamo coincide con la contratación', () => {
    const phase = warrantyRevisitPhase({
      ...claimBase,
      fechaTrabajo: '2026-10-20',
      horaInicio: '09:00:00',
      horaFin: '11:00:00',
      opciones: [
        option({
          id: 'visita',
          estado: 'aceptada',
          fechaTrabajo: '2026-09-12',
          horaInicio: '08:00:00',
          horaFin: '10:00:00',
          createdAt: '2026-09-01T12:00:00.000Z',
        }),
        option({
          id: 'revisita',
          estado: 'aceptada',
          fechaTrabajo: '2026-10-20',
          horaInicio: '09:00',
          horaFin: '11:00',
          createdAt: '2026-10-06T18:00:00.000Z',
        }),
      ],
    });
    expect(phase).toEqual({
      phase: 'confirmada',
      slot: { fecha: '2026-10-20', horaInicio: '09:00', horaFin: '11:00' },
    });
    expect(formatWarrantyRevisitConfirmed(phase.phase === 'confirmada' ? phase.slot : { fecha: '', horaInicio: '', horaFin: '' })).toBe(
      'Revisión confirmada: 20/10/2026 · 09:00 – 11:00',
    );
  });

  it('un reclamo sin horario nuevo no usa la fecha del trabajo original', () => {
    expect(
      warrantyRevisitPhase({
        ...claimBase,
        opciones: [
          option({
            id: 'visita',
            estado: 'aceptada',
            fechaTrabajo: '2026-09-12',
            horaInicio: '08:00:00',
            horaFin: '10:00:00',
            createdAt: '2026-09-01T12:00:00.000Z',
          }),
        ],
      }),
    ).toEqual({ phase: 'sin_horario' });
    expect(
      warrantyRevisitPhase({
        ...claimBase,
        fechaTrabajo: null,
        horaInicio: null,
        horaFin: null,
        opciones: [
          option({
            id: 'vieja',
            estado: 'aceptada',
            createdAt: '2026-10-06T18:00:00.000Z',
          }),
        ],
      }),
    ).toEqual({ phase: 'sin_horario' });
  });

  it('con propuestas abiertas no da por confirmada la aceptación anterior', () => {
    expect(
      warrantyRevisitPhase({
        ...claimBase,
        fechaTrabajo: null,
        horaInicio: null,
        horaFin: null,
        opciones: [
          option({
            id: 'revisita',
            estado: 'aceptada',
            createdAt: '2026-10-06T18:00:00.000Z',
          }),
          option({
            id: 'nueva',
            estado: 'propuesta',
            fechaTrabajo: '2026-10-22',
            createdAt: '2026-10-07T18:00:00.000Z',
          }),
        ],
      }).phase,
    ).toBe('propuestas');
  });

  it('otro trabajo no entra en la revisita', () => {
    expect(
      warrantyRevisitPhase({
        estadoTrabajo: 'en_curso',
        isClaimOpen: false,
        claimStatus: 'none',
        claimOpenedAt: null,
        fechaTrabajo: '2026-10-20',
        horaInicio: '09:00',
        horaFin: '11:00',
        opciones: [
          option({
            id: 'ok',
            estado: 'aceptada',
            createdAt: '2026-10-06T18:00:00.000Z',
          }),
        ],
      }),
    ).toEqual({ phase: 'sin_horario' });
    expect(
      warrantyRevisitPhase({
        estadoTrabajo: 'precio_aceptado',
        isClaimOpen: false,
        claimStatus: 'none',
        claimOpenedAt: null,
        fechaTrabajo: '2026-10-20',
        horaInicio: '09:00',
        horaFin: '11:00',
        opciones: [],
      }).phase,
    ).toBe('sin_horario');
  });
});

describe('la confirmación se ve en el chat y en el detalle, y reagendar es explícito', () => {
  const chat = readFileSync('src/screens/chat/ChatScreen.tsx', 'utf8');
  const detail = readFileSync('src/screens/servicios/DetalleServicioScreen.tsx', 'utf8');

  it('ambos roles ven el texto y el profesional cambia el horario a propósito', () => {
    expect(chat).toContain('formatWarrantyRevisitConfirmed(revisitConfirmada)');
    expect(chat).toContain('revisitConfirmadaVisible');
    expect(chat).toContain('!revisitConfirmadaVisible');
    expect(chat).toContain('accessibilityLabel="Cambiar horario"');
    const confirmed = chat.indexOf('formatWarrantyRevisitConfirmed(revisitConfirmada)');
    const workerOnly = chat.indexOf("participants?.myRole === 'trabajador'", confirmed);
    expect(confirmed).toBeGreaterThan(-1);
    expect(workerOnly).toBeGreaterThan(confirmed);

    expect(detail).toContain('formatWarrantyRevisitConfirmed(revisitPhase.slot)');
    expect(detail).toContain('setReagendarAbierto(true)');
    expect(detail).toContain('!revisitConfirmada || reagendarAbierto');
    const detailConfirmed = detail.indexOf('formatWarrantyRevisitConfirmed(revisitPhase.slot)');
    const detailForm = detail.indexOf("myRole === 'trabajador' && showAgendaForm");
    expect(detailConfirmed).toBeGreaterThan(-1);
    expect(detailConfirmed).toBeLessThan(detailForm);
    expect(detail).toContain('fetchDisponibilidadOpciones(contratacionId, !revisitAgenda)');
    expect(chat).toContain('fetchDisponibilidadOpciones(snapshot.id, !revisit)');
  });
});
