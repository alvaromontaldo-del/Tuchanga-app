export type BirthDateParts = { y: number; m: number; d: number };

export function parseBirthDateParts(raw: string | null | undefined): BirthDateParts | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Validación real de calendario (ej: 2026-02-30 invalida)
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function formatBirthDateDisplay(raw: string | null | undefined): string | null {
  const p = parseBirthDateParts(raw);
  if (!p) return null;
  const dd = String(p.d).padStart(2, '0');
  const mm = String(p.m).padStart(2, '0');
  return `${dd}/${mm}/${p.y}`;
}

/** Edad exacta con ajuste por mes/día. */
export function calcAgeFromBirthDate(raw: string | null | undefined, now = new Date()): number | null {
  const p = parseBirthDateParts(raw);
  if (!p) return null;
  const ty = now.getFullYear();
  const tm = now.getMonth() + 1;
  const td = now.getDate();
  let age = ty - p.y;
  if (tm < p.m || (tm === p.m && td < p.d)) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return age;
}

export function birthDateIsoFromDate(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateFromBirthDateIso(raw: string | null | undefined): Date | null {
  const p = parseBirthDateParts(raw);
  if (!p) return null;
  // Usamos mediodía local para evitar saltos por DST al mostrar.
  return new Date(p.y, p.m - 1, p.d, 12, 0, 0, 0);
}

