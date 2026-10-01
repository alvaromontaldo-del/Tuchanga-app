/** Franja horaria HH:MM (24 h). */
export type StoreHoursSlot = {
  open: string;
  close: string;
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeHHMM(value: string): boolean {
  return TIME_RE.test(value.trim());
}

export function timeToMinutes(value: string): number | null {
  const m = value.trim().match(TIME_RE);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function normalizeStoreOpeningHours(raw: unknown): StoreHoursSlot[] {
  if (!Array.isArray(raw)) return [];
  const slots: StoreHoursSlot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const open = String((row as { open?: string }).open ?? '').trim();
    const close = String((row as { close?: string }).close ?? '').trim();
    if (!isValidTimeHHMM(open) || !isValidTimeHHMM(close)) continue;
    const o = timeToMinutes(open)!;
    const c = timeToMinutes(close)!;
    if (c <= o) continue;
    slots.push({ open, close });
  }
  return slots.slice(0, 2);
}

export function formatStoreOpeningHours(slots: StoreHoursSlot[]): string {
  if (slots.length === 0) return '';
  return slots.map((s) => `${s.open} a ${s.close}`).join(' y de ');
}

export function validateStoreOpeningHours(slots: StoreHoursSlot[]): string | null {
  if (slots.length === 0) return null;
  for (const s of slots) {
    if (!isValidTimeHHMM(s.open) || !isValidTimeHHMM(s.close)) {
      return 'Usá horarios en formato HH:MM (ej. 09:00).';
    }
    const o = timeToMinutes(s.open)!;
    const c = timeToMinutes(s.close)!;
    if (c <= o) return 'La hora de cierre debe ser posterior a la de apertura.';
  }
  if (slots.length === 2) {
    const endFirst = timeToMinutes(slots[0].close)!;
    const startSecond = timeToMinutes(slots[1].open)!;
    if (startSecond <= endFirst) {
      return 'El segundo tramo debe empezar después del primero.';
    }
  }
  return null;
}

/** Estado inicial de un tramo: 9–18. */
export function defaultStoreOpeningHours(): StoreHoursSlot[] {
  return [{ open: '09:00', close: '18:00' }];
}

/**
 * Día de la grilla (1 = lunes … 7 = domingo).
 * `closed` no se persiste: en la base un día cerrado es `slots: []`.
 * Mientras se edita, los slots se conservan para poder reabrir el día.
 */
export type StoreDaySchedule = {
  day: number;
  closed: boolean;
  slots: StoreHoursSlot[];
};

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const STORE_WEEKDAY_LABELS: { day: number; label: string }[] = [
  { day: 1, label: 'Lun' },
  { day: 2, label: 'Mar' },
  { day: 3, label: 'Mié' },
  { day: 4, label: 'Jue' },
  { day: 5, label: 'Vie' },
  { day: 6, label: 'Sáb' },
  { day: 7, label: 'Dom' },
];

/** Desde y Hasta van en la misma fila. */
export const STORE_HOURS_TIME_ROW = { flexDirection: 'row' as const };

const WEEKDAY_INDEX: Record<string, number> = {
  lun: 1,
  lunes: 1,
  mon: 1,
  monday: 1,
  mar: 2,
  martes: 2,
  tue: 2,
  tuesday: 2,
  mie: 3,
  miercoles: 3,
  wed: 3,
  wednesday: 3,
  jue: 4,
  jueves: 4,
  thu: 4,
  thursday: 4,
  vie: 5,
  viernes: 5,
  fri: 5,
  friday: 5,
  sab: 6,
  sabado: 6,
  sat: 6,
  saturday: 6,
  dom: 7,
  domingo: 7,
  sun: 7,
  sunday: 7,
};

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dayNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw === 0) return 7;
    if (raw >= 1 && raw <= 7) return raw;
  }
  const key = stripAccents(String(raw ?? '').trim().toLowerCase());
  return WEEKDAY_INDEX[key] ?? null;
}

function cloneSlots(slots: StoreHoursSlot[]): StoreHoursSlot[] {
  return slots.slice(0, 2).map((slot) => ({
    open: String(slot?.open ?? ''),
    close: String(slot?.close ?? ''),
  }));
}

function openDay(day: number, slots: StoreHoursSlot[] = defaultStoreOpeningHours()): StoreDaySchedule {
  const next = cloneSlots(slots);
  return {
    day,
    closed: false,
    slots: next.length > 0 ? next : defaultStoreOpeningHours(),
  };
}

function closedDay(day: number, slots: StoreHoursSlot[] = defaultStoreOpeningHours()): StoreDaySchedule {
  const next = cloneSlots(slots);
  return {
    day,
    closed: true,
    slots: next.length > 0 ? next : defaultStoreOpeningHours(),
  };
}

/** Lun a dom, cada uno abierto de 09:00 a 18:00. */
export function defaultStoreWeekSchedule(): StoreDaySchedule[] {
  return WEEK_DAYS.map((day) => openDay(day));
}

function isEditorWeek(raw: unknown): raw is StoreDaySchedule[] {
  return (
    Array.isArray(raw) &&
    raw.some(
      (row) => row && typeof row === 'object' && 'day' in row && 'closed' in row,
    )
  );
}

/**
 * Completa la grilla de 7 días sin validar HH:MM (el editor puede estar a medias).
 */
export function ensureStoreWeekShape(
  days: StoreDaySchedule[] | null | undefined,
): StoreDaySchedule[] {
  const byDay = new Map((days ?? []).map((day) => [day.day, day]));
  return WEEK_DAYS.map((day) => {
    const found = byDay.get(day);
    if (!found) return openDay(day);
    const slots = cloneSlots(found.slots ?? []);
    if (found.closed || slots.length === 0) return closedDay(day, slots);
    return { day, closed: false, slots };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Lista de días o de franjas, venga como array, `{ schedule }`, `{ days }`
 * o como string JSON de cualquiera de esos.
 */
export function readOpeningHoursList(raw: unknown): unknown[] | null {
  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (Array.isArray(record?.schedule)) return record.schedule;
  if (Array.isArray(record?.days)) return record.days;
  return null;
}

/**
 * Lee lo guardado en `stores.opening_hours`.
 * Acepta `{ schedule: [{ day, slots }] }`, `{ days: [...] }`, la lista plana
 * y un string JSON. El formato viejo `[{ open, close }]` se aplica a los 7 días.
 */
export function normalizeStoreWeekSchedule(raw: unknown): StoreDaySchedule[] {
  const list = readOpeningHoursList(raw);
  if (isEditorWeek(list)) return ensureStoreWeekShape(list);
  if (!list || list.length === 0) return defaultStoreWeekSchedule();

  const weekly: { day: number; slots: StoreHoursSlot[] }[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const day = dayNumber(obj.day ?? obj.weekday ?? obj.dia);
    if (day == null) continue;
    const source = Array.isArray(obj.slots)
      ? obj.slots
      : Array.isArray(obj.hours)
        ? obj.hours
        : obj.open
          ? [obj]
          : [];
    weekly.push({ day, slots: normalizeStoreOpeningHours(source) });
  }

  if (weekly.length > 0) {
    return WEEK_DAYS.map((day) => {
      const found = [...weekly].reverse().find((row) => row.day === day);
      if (!found || found.slots.length === 0) return closedDay(day);
      return openDay(day, found.slots);
    });
  }

  const legacy = normalizeStoreOpeningHours(list);
  if (legacy.length === 0) return defaultStoreWeekSchedule();
  return WEEK_DAYS.map((day) => openDay(day, legacy));
}

/** JSON que se guarda en `stores.opening_hours`. Día cerrado → `slots: []`. */
export function storeWeekScheduleToJson(days: StoreDaySchedule[]): {
  schedule: { day: number; slots: StoreHoursSlot[] }[];
} {
  return {
    schedule: ensureStoreWeekShape(days).map((day) => ({
      day: day.day,
      slots: day.closed
        ? []
        : day.slots.slice(0, 2).map((slot) => ({
            open: slot.open.trim(),
            close: slot.close.trim(),
          })),
    })),
  };
}

export function validateStoreWeekSchedule(days: StoreDaySchedule[]): string | null {
  const week = ensureStoreWeekShape(days);
  if (!week.some((day) => !day.closed)) {
    return 'Indicá el horario de al menos un día.';
  }
  for (const day of week) {
    if (day.closed) continue;
    const err = validateStoreOpeningHours(day.slots);
    if (err) {
      const label = STORE_WEEKDAY_LABELS.find((item) => item.day === day.day)?.label ?? 'Día';
      return `${label}: ${err}`;
    }
  }
  return null;
}

/** Copia el horario del martes (abierto o cerrado) a miércoles, jueves y viernes. */
export function copyTuesdayHoursToFriday(days: StoreDaySchedule[]): StoreDaySchedule[] {
  const week = ensureStoreWeekShape(days);
  const tuesday = week.find((day) => day.day === 2);
  if (!tuesday) return week;
  return week.map((day) => {
    if (day.day < 3 || day.day > 5) return day;
    return {
      day: day.day,
      closed: tuesday.closed,
      slots: cloneSlots(tuesday.slots),
    };
  });
}

export function setStoreDayClosed(
  days: StoreDaySchedule[],
  day: number,
  closed: boolean,
): StoreDaySchedule[] {
  return ensureStoreWeekShape(days).map((row) =>
    row.day === day ? { ...row, closed } : row,
  );
}

const SPLIT_MORNING_SLOT: StoreHoursSlot = { open: '09:00', close: '13:00' };
const SPLIT_AFTERNOON_SLOT: StoreHoursSlot = { open: '15:00', close: '19:00' };

function copySlot(slot: StoreHoursSlot): StoreHoursSlot {
  return { open: slot.open, close: slot.close };
}

function slotsPassValidation(slots: StoreHoursSlot[]): boolean {
  return slots.length > 0 && validateStoreOpeningHours(slots) == null;
}

/**
 * Cortado: mañana + tarde. Si la franja actual pisa la tarde, la mañana pasa
 * a 09:00–13:00 para que la tarde empiece después. Si aun así no entra, queda
 * el par 09:00–13:00 y 15:00–19:00.
 */
function cortadoSlots(existing: StoreHoursSlot[]): StoreHoursSlot[] {
  const first = existing[0] ?? defaultStoreOpeningHours()[0];
  const second = existing[1] ?? SPLIT_AFTERNOON_SLOT;
  const asIs = [copySlot(first), copySlot(second)];
  if (slotsPassValidation(asIs)) return asIs;

  const morningFixed = [copySlot(SPLIT_MORNING_SLOT), copySlot(second)];
  if (slotsPassValidation(morningFixed)) return morningFixed;

  return [copySlot(SPLIT_MORNING_SLOT), copySlot(SPLIT_AFTERNOON_SLOT)];
}

/** Corrido: una sola franja válida. Si la mañana no cierra después de abrir, 09:00–18:00. */
function corridoSlots(existing: StoreHoursSlot[]): StoreHoursSlot[] {
  const first = existing[0];
  if (first) {
    const slot = copySlot(first);
    if (slotsPassValidation([slot])) return [slot];
  }
  return defaultStoreOpeningHours();
}

/**
 * Corrido deja solo la primera franja, si es válida.
 * Cortado agrega la tarde (15:00–19:00) y acorta la mañana si se superponen.
 */
export function setStoreDaySplit(
  days: StoreDaySchedule[],
  day: number,
  split: boolean,
): StoreDaySchedule[] {
  return ensureStoreWeekShape(days).map((row) => {
    if (row.day !== day) return row;
    return { ...row, slots: split ? cortadoSlots(row.slots) : corridoSlots(row.slots) };
  });
}

export function patchStoreDaySlot(
  days: StoreDaySchedule[],
  day: number,
  index: number,
  patch: Partial<StoreHoursSlot>,
): StoreDaySchedule[] {
  return ensureStoreWeekShape(days).map((row) => {
    if (row.day !== day) return row;
    const slots = row.slots.map((slot, slotIndex) =>
      slotIndex === index ? { ...slot, ...patch } : slot,
    );
    return { ...row, slots };
  });
}

export type StoreOpeningHoursEditorRow = {
  day: number;
  label: string;
  closed: boolean;
  slots: StoreHoursSlot[];
  /** Desde y Hasta se renderizan en la misma fila. */
  timeFieldsShareRow: true;
};

/** Filas del editor: un día de lun a dom, con su horario y si está cerrado. */
export function storeOpeningHoursEditorRows(
  days: StoreDaySchedule[],
): StoreOpeningHoursEditorRow[] {
  const week = ensureStoreWeekShape(days);
  return STORE_WEEKDAY_LABELS.map(({ day, label }) => {
    const row = week.find((item) => item.day === day) ?? openDay(day);
    return {
      day,
      label,
      closed: row.closed,
      slots: row.slots,
      timeFieldsShareRow: true,
    };
  });
}
