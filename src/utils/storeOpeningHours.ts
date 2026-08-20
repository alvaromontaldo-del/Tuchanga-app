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

/** Estado inicial del editor: un tramo 9–18. */
export function defaultStoreOpeningHours(): StoreHoursSlot[] {
  return [{ open: '09:00', close: '18:00' }];
}
