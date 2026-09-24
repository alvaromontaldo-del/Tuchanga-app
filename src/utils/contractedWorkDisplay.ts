/**
 * Nombre visible del profesional en Trabajos contratados.
 * Solo el nombre de pila (`profiles.nombre`); no se muestra la inicial del apellido.
 */
export function workerGivenName(nombre: string | null | undefined): string {
  const s = (nombre ?? '').trim();
  return s || 'Profesional';
}

/**
 * Monto que cobra el profesional.
 * `precio_final` = pago al profesional + costo de servicio YaChanga (`comision_app`).
 * En el listado del cliente se muestra solo `precio_trabajador`.
 */
export function professionalPayoutAmount(row: {
  precio_trabajador: number;
  precio_final: number;
  comision_app: number;
}): number {
  if (Number.isFinite(row.precio_trabajador) && row.precio_trabajador > 0) {
    return row.precio_trabajador;
  }
  return Math.max(0, (Number(row.precio_final) || 0) - (Number(row.comision_app) || 0));
}
