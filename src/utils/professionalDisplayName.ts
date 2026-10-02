/**
 * Nombre de un profesional que puede ver un cliente.
 * Solo `profiles.nombre`, recortado. Si el texto trae una inicial de apellido
 * colgada («Horacio T.»), se descarta. Un nombre compuesto («Ana María»)
 * se conserva entero. No recibe ni devuelve el apellido.
 */
export function professionalDisplayNameForClient(nombre: string | null | undefined): string {
  const s = (nombre ?? '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'Profesional';
  const withoutInitial = s.replace(/\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]\.?$/u, '').trim();
  return withoutInitial || 'Profesional';
}
