/**
 * Nombre visible en la búsqueda pública: nombre de pila + inicial del apellido.
 * Acepta el apellido completo (RPC vieja) o solo la inicial (RPC nueva).
 */
export function lastNameInitial(apellido: string | null | undefined): string {
  const raw = (apellido ?? '').trim().replace(/\.$/u, '');
  if (!raw) return '';
  const initial = raw.charAt(0);
  return initial ? initial.toLocaleUpperCase('es-AR') : '';
}

export function publicWorkerLabel(
  nombre: string | null | undefined,
  apellido: string | null | undefined,
): string {
  const first = (nombre ?? '').replace(/\s+/g, ' ').trim() || 'Profesional';
  const initial = lastNameInitial(apellido);
  return initial ? `${first} ${initial}.` : first;
}

/** Grilla de ~1 km (2 decimales). Sirve para un pin, no para el domicilio. */
export function coarseCoord(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 100) / 100;
}
