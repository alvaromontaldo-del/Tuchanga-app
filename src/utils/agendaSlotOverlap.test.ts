import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENDA_DEFAULT_DURATION_MINUTES,
  agendaPickerFieldForOverlap,
  agendaRangesOverlap,
  agendaSlotBounds,
  buenosAiresWallTimeToUtcMs,
  collectBusyAgendaSlots,
  findAgendaSlotOverlap,
  formatAgendaDia,
  formatAgendaOverlapMessage,
  slotOverlapFromRpcError,
  SlotOverlapError,
  type AgendaJobRow,
  type AgendaProposalRow,
  type BusyAgendaSlot,
} from './agendaSlotOverlap';

const OTHER = '22222222-2222-4222-8222-222222222222';
const CURRENT = '11111111-1111-4111-8111-111111111111';

function confirmed(
  partial: Partial<BusyAgendaSlot> & Pick<BusyAgendaSlot, 'fecha' | 'horaInicio'>,
): BusyAgendaSlot {
  return {
    contratacionId: OTHER,
    source: 'confirmed',
    estadoTrabajo: 'aceptado',
    horaFin: '11:00',
    ...partial,
  };
}

describe('agendaSlotOverlap', () => {
  it('interpreta el reloj de pared en America/Buenos_Aires (UTC−3)', () => {
    expect(buenosAiresWallTimeToUtcMs('2026-10-03', '09:00')).toBe(
      Date.parse('2026-10-03T12:00:00.000Z'),
    );
    expect(buenosAiresWallTimeToUtcMs('2026-10-03', '00:00')).toBe(
      Date.parse('2026-10-03T03:00:00.000Z'),
    );
  });

  it('el día del mensaje es el día civil de Buenos Aires', () => {
    expect(formatAgendaDia('2026-10-02')).toBe('viernes 02/10');
  });

  it('arma el mensaje en español con día y horario del turno ocupado', () => {
    expect(
      formatAgendaOverlapMessage({
        fecha: '2026-10-02',
        horaInicio: '09:00',
        horaFin: '11:00',
      }),
    ).toBe(
      'Ya tenés agendado un trabajo el viernes 02/10 de 09:00 a 11:00. Elegí otro día u horario.',
    );
  });

  it('pisa rangos que se cruzan y no el contacto exacto', () => {
    const a = agendaSlotBounds({ fecha: '2026-10-02', horaInicio: '09:00', horaFin: '10:00' });
    const touch = agendaSlotBounds({ fecha: '2026-10-02', horaInicio: '10:00', horaFin: '11:00' });
    const cross = agendaSlotBounds({ fecha: '2026-10-02', horaInicio: '09:30', horaFin: '10:30' });
    const inside = agendaSlotBounds({ fecha: '2026-10-02', horaInicio: '09:15', horaFin: '09:45' });
    if (!a || !touch || !cross || !inside) throw new Error('bounds');
    expect(agendaRangesOverlap(a, touch)).toBe(false);
    expect(agendaRangesOverlap(a, cross)).toBe(true);
    expect(agendaRangesOverlap(a, inside)).toBe(true);
    expect(agendaRangesOverlap(inside, a)).toBe(true);
  });

  it('sin hora de fin usa 60 minutos y puede cruzar la medianoche', () => {
    expect(AGENDA_DEFAULT_DURATION_MINUTES).toBe(60);
    const open = agendaSlotBounds({ fecha: '2026-10-02', horaInicio: '23:30', horaFin: null });
    expect(open?.horaFin).toBe('00:30');
    const nextMorning = agendaSlotBounds({
      fecha: '2026-10-03',
      horaInicio: '00:10',
      horaFin: '01:00',
    });
    if (!open || !nextMorning) throw new Error('bounds');
    expect(agendaRangesOverlap(open, nextMorning)).toBe(true);

    const hit = findAgendaSlotOverlap({
      proposals: [{ fecha: '2026-10-02', horaInicio: '23:30', horaFin: null }],
      busy: [
        confirmed({
          fecha: '2026-10-03',
          horaInicio: '00:10',
          horaFin: '01:00',
          estadoTrabajo: 'en_curso',
        }),
      ],
    });
    expect(hit?.conflict.horaFin).toBe('01:00');
    expect(hit?.message).toContain('sábado 03/10 de 00:10 a 01:00');
  });

  it('bloquea aceptado y en_curso, y una propuesta pendiente de otro trabajo', () => {
    const jobs: AgendaJobRow[] = [
      {
        id: 'a',
        estadoTrabajo: 'aceptado',
        fechaTrabajo: '2026-10-02',
        horaInicio: '09:00',
        horaFin: '11:00',
      },
      {
        id: 'b',
        estadoTrabajo: 'en_curso',
        fechaTrabajo: '2026-10-04',
        horaInicio: '15:00',
        horaFin: '16:00',
      },
      {
        id: 'c',
        estadoTrabajo: 'precio_aceptado',
        fechaTrabajo: null,
        horaInicio: null,
        horaFin: null,
      },
      {
        id: 'done',
        estadoTrabajo: 'finalizado',
        fechaTrabajo: '2026-10-05',
        horaInicio: '09:00',
        horaFin: '12:00',
      },
      {
        id: 'cancelled',
        estadoTrabajo: 'cancelado',
        fechaTrabajo: '2026-10-06',
        horaInicio: '09:00',
        horaFin: '12:00',
      },
      {
        id: 'dispute',
        estadoTrabajo: 'disputa',
        fechaTrabajo: '2026-10-07',
        horaInicio: '09:00',
        horaFin: '12:00',
      },
      {
        id: 'conformidad',
        estadoTrabajo: 'pendiente_conformidad',
        fechaTrabajo: '2026-10-08',
        horaInicio: '09:00',
        horaFin: '12:00',
      },
    ];
    const proposals: AgendaProposalRow[] = [
      {
        contratacionId: 'c',
        estado: 'propuesta',
        fechaTrabajo: '2026-10-09',
        horaInicio: '18:00',
        horaFin: '19:00',
      },
      {
        contratacionId: 'done',
        estado: 'propuesta',
        fechaTrabajo: '2026-10-05',
        horaInicio: '09:00',
        horaFin: '10:00',
      },
      {
        contratacionId: 'c',
        estado: 'descartada',
        fechaTrabajo: '2026-10-02',
        horaInicio: '09:00',
        horaFin: '10:00',
      },
      {
        contratacionId: 'cancelled',
        estado: 'propuesta',
        fechaTrabajo: '2026-10-06',
        horaInicio: '09:00',
        horaFin: '10:00',
      },
    ];

    const busy = collectBusyAgendaSlots(jobs, proposals);
    expect(busy.map((slot) => slot.contratacionId).sort()).toEqual(['a', 'b', 'c']);

    expect(
      findAgendaSlotOverlap({
        proposals: [{ fecha: '2026-10-02', horaInicio: '10:00', horaFin: '12:00' }],
        busy,
      })?.conflict.contratacionId,
    ).toBe('a');

    expect(
      findAgendaSlotOverlap({
        proposals: [{ fecha: '2026-10-04', horaInicio: '15:30', horaFin: '16:30' }],
        busy,
      })?.message,
    ).toContain('domingo 04/10 de 15:00 a 16:00');

    expect(
      findAgendaSlotOverlap({
        proposals: [{ fecha: '2026-10-09', horaInicio: '18:15', horaFin: '18:45' }],
        busy,
      })?.conflict.contratacionId,
    ).toBe('c');

    for (const fecha of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
      expect(
        findAgendaSlotOverlap({
          proposals: [{ fecha, horaInicio: '09:00', horaFin: '12:00' }],
          busy,
        }),
      ).toBeNull();
    }
  });

  it('no bloquea reenviar o editar el mismo turno del mismo trabajo', () => {
    const busy = [
      confirmed({
        contratacionId: CURRENT,
        fecha: '2026-10-02',
        horaInicio: '09:00',
        horaFin: '11:00',
      }),
      {
        contratacionId: CURRENT,
        source: 'pending_proposal' as const,
        estadoTrabajo: 'precio_aceptado',
        fecha: '2026-10-02',
        horaInicio: '09:00',
        horaFin: '11:00',
      },
    ];
    expect(
      findAgendaSlotOverlap({
        proposals: [{ fecha: '2026-10-02', horaInicio: '09:00', horaFin: '11:00' }],
        busy,
        excludeContratacionId: CURRENT,
      }),
    ).toBeNull();
  });

  it('señala la primera opción que pisa y abre la hora si el día coincide', () => {
    const hit = findAgendaSlotOverlap({
      proposals: [
        { fecha: '2026-10-02', horaInicio: '08:00', horaFin: '09:00' },
        { fecha: '2026-10-02', horaInicio: '10:30', horaFin: '11:30' },
      ],
      busy: [confirmed({ fecha: '2026-10-02', horaInicio: '11:00', horaFin: '12:00' })],
    });
    expect(hit?.proposalIndex).toBe(1);
    expect(agendaPickerFieldForOverlap('2026-10-02', hit?.conflict.fecha ?? '')).toBe('horaInicio');
    expect(agendaPickerFieldForOverlap('2026-10-03', '2026-10-02')).toBe('fecha');
  });

  it('traduce el error slot_overlap del RPC al mensaje y al índice', () => {
    const err = slotOverlapFromRpcError({
      message: 'slot_overlap',
      details: 'fecha=2026-10-02;hora_inicio=09:00;hora_fin=11:00;opcion_index=2',
      code: 'P0001',
    } as { message: string; details: string });
    expect(err).toBeInstanceOf(SlotOverlapError);
    expect(err?.proposalIndex).toBe(2);
    expect(err?.conflictFecha).toBe('2026-10-02');
    expect(err?.message).toBe(
      'Ya tenés agendado un trabajo el viernes 02/10 de 09:00 a 11:00. Elegí otro día u horario.',
    );
    expect(err?.code).toBe('slot_overlap');
  });

  it('el SQL recrea la propuesta en vivo y rechaza el solape con código slot_overlap', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/20261002_card_43_agenda_overlap.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.proponer_disponibilidad_opciones');
    expect(sql).toContain("RAISE EXCEPTION 'slot_overlap'");
    expect(sql).toContain("'America/Buenos_Aires'");
    expect(sql).toContain("c.estado_trabajo IN ('aceptado', 'en_curso')");
    expect(sql).toContain("o.estado = 'propuesta'");
    expect(sql).toContain("c.estado_trabajo IN ('precio_aceptado', 'aceptado', 'en_curso')");
    expect(sql).toContain('IS DISTINCT FROM p_exclude_contratacion_id');
    expect(sql).toContain('b.start_at < v_end');
    expect(sql).toContain('b.end_at > v_start');
    expect(sql).toContain("interval '60 minutes'");
    expect(sql).toContain('(Garantía) Propongo estos horarios para la revisión');
    expect(sql).toContain('PERFORM public._agenda_lock_worker(v_row.worker_id)');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.aceptar_disponibilidad');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.proponer_reagendar_visita');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.calc_yachanga_service_fee');
    expect(sql).not.toMatch(/estado_trabajo IN \([^)]*'cancelado'/);
    expect(sql).not.toMatch(/estado_trabajo IN \([^)]*'finalizado'/);
  });
});
