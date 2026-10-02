/**
 * Solape de turnos de la agenda del profesional (card #43).
 *
 * Ocupado:
 * - `aceptado` (confirmado / aceptado) y `en_curso`, con fecha y hora.
 * - opción `propuesta` todavía sin aceptar, si el trabajo está en
 *   `precio_aceptado`, `aceptado` o `en_curso` (pendiente de aceptación).
 *
 * No ocupan: `cancelado`, `finalizado`, `disputa`, `pendiente_conformidad`,
 * `pendiente_pago_diferencia`, `pendiente`, `precio_cotizado`, ni opciones
 * `descartada` / `aceptada` (la aceptada queda en el trabajo confirmado).
 *
 * El trabajo que se está editando no cuenta: reenviar el mismo turno no se bloquea.
 * Sin hora de fin se usa 60 minutos, igual que el formulario de agenda.
 * Las horas son reloj de pared en America/Buenos_Aires.
 */

export const AGENDA_TIME_ZONE = 'America/Buenos_Aires';

/** Duración si el turno no trae hora de fin. Coincide con el +1 h del formulario. */
export const AGENDA_DEFAULT_DURATION_MINUTES = 60;

export const AGENDA_BUSY_CONFIRMED_STATUSES = ['aceptado', 'en_curso'] as const;

export const AGENDA_BUSY_PENDING_JOB_STATUSES = [
  'precio_aceptado',
  'aceptado',
  'en_curso',
] as const;

export const SLOT_OVERLAP_ERROR_CODE = 'slot_overlap';

const WEEKDAYS_ES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;

const CONFIRMED = new Set<string>(AGENDA_BUSY_CONFIRMED_STATUSES);
const PENDING_JOB = new Set<string>(AGENDA_BUSY_PENDING_JOB_STATUSES);

export type AgendaJobRow = {
  id: string;
  estadoTrabajo: string;
  fechaTrabajo?: string | null;
  horaInicio?: string | null;
  horaFin?: string | null;
};

export type AgendaProposalRow = {
  contratacionId: string;
  estado: string;
  fechaTrabajo?: string | null;
  horaInicio?: string | null;
  horaFin?: string | null;
};

export type BusyAgendaSlot = {
  contratacionId: string;
  source: 'confirmed' | 'pending_proposal';
  estadoTrabajo: string;
  fecha: string;
  horaInicio: string;
  horaFin?: string | null;
};

export type AgendaProposalInput = {
  fecha: string;
  horaInicio: string;
  horaFin?: string | null;
};

export type AgendaOverlapHit = {
  proposalIndex: number;
  message: string;
  conflict: {
    fecha: string;
    horaInicio: string;
    horaFin: string;
    contratacionId: string;
  };
};

type WallParts = { y: number; mo: number; d: number; h: number; m: number };

function wallPartsInZone(utcMs: number, timeZone: string): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let h = Number(bag.hour);
  if (h === 24) h = 0;
  return {
    y: Number(bag.year),
    mo: Number(bag.month),
    d: Number(bag.day),
    h,
    m: Number(bag.minute),
  };
}

function wallAsUtcMs(parts: WallParts): number {
  return Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.m, 0);
}

/** Reloj de pared en America/Buenos_Aires → epoch UTC. */
export function buenosAiresWallTimeToUtcMs(fecha: string, hora: string): number {
  const [y, mo, d] = fecha.split('-').map(Number);
  const [hRaw, mRaw] = hora.split(':');
  const desired: WallParts = { y, mo, d, h: Number(hRaw), m: Number(mRaw) };
  let utc = wallAsUtcMs(desired);
  for (let i = 0; i < 4; i += 1) {
    const got = wallPartsInZone(utc, AGENDA_TIME_ZONE);
    const delta = wallAsUtcMs(desired) - wallAsUtcMs(got);
    if (delta === 0) return utc;
    utc += delta;
  }
  return utc;
}

export function formatHmBuenosAires(utcMs: number): string {
  const parts = wallPartsInZone(utcMs, AGENDA_TIME_ZONE);
  return `${String(parts.h).padStart(2, '0')}:${String(parts.m).padStart(2, '0')}`;
}

export function normalizeHm(value: string): string {
  const [hRaw, mRaw] = value.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return value.slice(0, 5);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Día civil en Buenos Aires, p. ej. «viernes 02/10». */
export function formatAgendaDia(fecha: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!match) return fecha;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  // 15:00 UTC es mediodía en Buenos Aires (UTC−3, sin horario de verano): mismo día civil.
  const weekday = WEEKDAYS_ES[new Date(Date.UTC(y, mo - 1, d, 15, 0, 0)).getUTCDay()];
  return `${weekday} ${match[3]}/${match[2]}`;
}

export function formatAgendaOverlapMessage(conflict: {
  fecha: string;
  horaInicio: string;
  horaFin: string;
}): string {
  const dia = formatAgendaDia(conflict.fecha);
  const ini = normalizeHm(conflict.horaInicio);
  const fin = normalizeHm(conflict.horaFin);
  return `Ya tenés agendado un trabajo el ${dia} de ${ini} a ${fin}. Elegí otro día u horario.`;
}

export function agendaPickerFieldForOverlap(
  proposalFecha: string,
  conflictFecha: string,
): 'fecha' | 'horaInicio' {
  return proposalFecha === conflictFecha ? 'horaInicio' : 'fecha';
}

type Bounds = { startMs: number; endMs: number; horaFin: string };

function hasWallClock(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{1,2}:\d{2}/.test(value));
}

export function agendaSlotBounds(slot: {
  fecha: string;
  horaInicio: string;
  horaFin?: string | null;
}): Bounds | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.fecha) || !hasWallClock(slot.horaInicio)) return null;
  const startMs = buenosAiresWallTimeToUtcMs(slot.fecha, slot.horaInicio);
  if (!Number.isFinite(startMs)) return null;
  if (hasWallClock(slot.horaFin)) {
    const endMs = buenosAiresWallTimeToUtcMs(slot.fecha, slot.horaFin);
    if (Number.isFinite(endMs) && endMs > startMs) {
      return { startMs, endMs, horaFin: normalizeHm(slot.horaFin) };
    }
  }
  const endMs = startMs + AGENDA_DEFAULT_DURATION_MINUTES * 60 * 1000;
  return { startMs, endMs, horaFin: formatHmBuenosAires(endMs) };
}

/** Los rangos se pisan si start < otherEnd y end > otherStart. El contacto exacto no pisa. */
export function agendaRangesOverlap(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): boolean {
  return a.startMs < b.endMs && a.endMs > b.startMs;
}

export function collectBusyAgendaSlots(
  jobs: AgendaJobRow[],
  proposals: AgendaProposalRow[],
): BusyAgendaSlot[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const busy: BusyAgendaSlot[] = [];

  for (const job of jobs) {
    if (!CONFIRMED.has(job.estadoTrabajo)) continue;
    if (!job.fechaTrabajo || !hasWallClock(job.horaInicio)) continue;
    busy.push({
      contratacionId: job.id,
      source: 'confirmed',
      estadoTrabajo: job.estadoTrabajo,
      fecha: job.fechaTrabajo,
      horaInicio: job.horaInicio,
      horaFin: job.horaFin,
    });
  }

  for (const proposal of proposals) {
    if (proposal.estado !== 'propuesta') continue;
    const job = jobsById.get(proposal.contratacionId);
    if (!job || !PENDING_JOB.has(job.estadoTrabajo)) continue;
    if (!proposal.fechaTrabajo || !hasWallClock(proposal.horaInicio)) continue;
    busy.push({
      contratacionId: proposal.contratacionId,
      source: 'pending_proposal',
      estadoTrabajo: job.estadoTrabajo,
      fecha: proposal.fechaTrabajo,
      horaInicio: proposal.horaInicio,
      horaFin: proposal.horaFin,
    });
  }

  return busy;
}

export function findAgendaSlotOverlap(input: {
  proposals: AgendaProposalInput[];
  busy: BusyAgendaSlot[];
  excludeContratacionId?: string | null;
}): AgendaOverlapHit | null {
  const exclude = input.excludeContratacionId ?? null;
  const busy = input.busy.filter((slot) => slot.contratacionId !== exclude);

  for (let index = 0; index < input.proposals.length; index += 1) {
    const proposal = input.proposals[index];
    const proposed = agendaSlotBounds(proposal);
    if (!proposed) continue;

    const hits = busy
      .map((slot) => ({ slot, bounds: agendaSlotBounds(slot) }))
      .filter((hit): hit is { slot: BusyAgendaSlot; bounds: Bounds } => {
        return hit.bounds != null && agendaRangesOverlap(proposed, hit.bounds);
      })
      .sort((a, b) => a.bounds.startMs - b.bounds.startMs);

    const first = hits[0];
    if (!first) continue;

    const conflict = {
      fecha: first.slot.fecha,
      horaInicio: normalizeHm(first.slot.horaInicio),
      horaFin: first.bounds.horaFin,
      contratacionId: first.slot.contratacionId,
    };
    return {
      proposalIndex: index,
      message: formatAgendaOverlapMessage(conflict),
      conflict,
    };
  }

  return null;
}

const OVERLAP_DETAIL =
  /fecha=(\d{4}-\d{2}-\d{2});hora_inicio=(\d{2}:\d{2});hora_fin=(\d{2}:\d{2});opcion_index=(\d+)/;

export class SlotOverlapError extends Error {
  readonly code = SLOT_OVERLAP_ERROR_CODE;

  constructor(
    message: string,
    readonly proposalIndex: number,
    readonly conflictFecha: string,
  ) {
    super(message);
    this.name = 'SlotOverlapError';
  }
}

export function slotOverlapFromRpcError(error: {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}): SlotOverlapError | null {
  const blob = [error.message, error.details, error.hint].filter(Boolean).join('\n');
  if (!blob.toLowerCase().includes(SLOT_OVERLAP_ERROR_CODE)) return null;

  const match = OVERLAP_DETAIL.exec(blob);
  if (!match) {
    return new SlotOverlapError(
      'Ya tenés agendado un trabajo en ese horario. Elegí otro día u horario.',
      0,
      '',
    );
  }

  const fecha = match[1];
  const horaInicio = match[2];
  const horaFin = match[3];
  return new SlotOverlapError(
    formatAgendaOverlapMessage({ fecha, horaInicio, horaFin }),
    Number(match[4]),
    fecha,
  );
}
