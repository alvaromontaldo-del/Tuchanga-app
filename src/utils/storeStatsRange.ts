/**
 * Períodos de «Datos de gestión».
 * El calendario es Argentina (UTC−3 fijo, sin horario de verano).
 * No usa la zona del dispositivo.
 */

const ART_OFFSET_MS = 3 * 60 * 60 * 1000;
const MS_PER_DAY = 86_400_000;

/** Igual que el tope de `get_store_stats`: p_to - p_from > 366. */
export const STORE_STATS_MAX_RANGE_DAYS = 366;

export type StoreStatsPreset = 'today' | 'week' | 'month' | 'custom';

export type StoreStatsRange = {
  from: string;
  to: string;
};

export type CustomRangeIssue = 'invalid_range' | 'range_too_long' | 'future';

type Ymd = { y: number; m: number; d: number };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYmd(parts: Ymd): string {
  return `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
}

function artCalendar(now: Date): Ymd & { weekday: number } {
  const shifted = new Date(now.getTime() - ART_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function parseYmd(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

function ymdUtc(parts: Ymd): number {
  return Date.UTC(parts.y, parts.m - 1, parts.d);
}

function addDays(parts: Ymd, days: number): Ymd {
  const utc = new Date(ymdUtc(parts) + days * MS_PER_DAY);
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

function compareYmd(a: Ymd, b: Ymd): number {
  return ymdUtc(a) - ymdUtc(b);
}

function daysBetween(from: Ymd, to: Ymd): number {
  return Math.round((ymdUtc(to) - ymdUtc(from)) / MS_PER_DAY);
}

/**
 * from ≤ to, como máximo 366 días de diferencia, y ninguna fecha posterior a hoy en Argentina.
 * null = válido.
 */
export function validateCustomRange(from: string, to: string, now: Date): CustomRangeIssue | null {
  const start = parseYmd(from);
  const end = parseYmd(to);
  if (!start || !end || compareYmd(end, start) < 0) return 'invalid_range';
  if (daysBetween(start, end) > STORE_STATS_MAX_RANGE_DAYS) return 'range_too_long';
  const today = artCalendar(now);
  if (compareYmd(start, today) > 0 || compareYmd(end, today) > 0) return 'future';
  return null;
}

export function storeStatsRange(
  preset: StoreStatsPreset,
  now: Date,
  custom?: { from: string; to: string },
): StoreStatsRange {
  if (preset === 'custom') {
    const from = custom?.from ?? '';
    const to = custom?.to ?? '';
    const issue = validateCustomRange(from, to, now);
    if (issue) throw new Error(issue);
    return { from: formatYmd(parseYmd(from)!), to: formatYmd(parseYmd(to)!) };
  }

  const today = artCalendar(now);
  const to = formatYmd(today);
  if (preset === 'today') return { from: to, to };
  if (preset === 'week') {
    const daysFromMonday = today.weekday === 0 ? 6 : today.weekday - 1;
    return { from: formatYmd(addDays(today, -daysFromMonday)), to };
  }
  return { from: formatYmd({ y: today.y, m: today.m, d: 1 }), to };
}
