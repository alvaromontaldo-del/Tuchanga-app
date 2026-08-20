/**
 * Identificador legible del usuario: `{dni}_{Apellido}` (ej. `30123456_Montaldo`).
 * El UID de Auth sigue siendo UUID (limitación de Supabase); esto va en Display name / metadata.
 */
export function userAuthDisplayName(params: {
  dni?: string | null;
  lastName?: string | null;
}): string | null {
  const dni = String(params.dni ?? '')
    .replace(/\D/g, '')
    .slice(0, 12);
  const apellidoRaw = String(params.lastName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim();
  if (!dni || !apellidoRaw) return null;

  const apellido = apellidoRaw
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');

  return apellido ? `${dni}_${apellido}` : dni;
}

/**
 * Carpeta dueña en Storage (avatars / job-photos).
 * Formato: `{dni}_{apellido}` en minúsculas (ej. `30123456_montaldo`).
 * Fallback al UUID si aún no hay DNI/apellido.
 */
export function storageOwnerFolder(params: {
  userId: string;
  dni?: string | null;
  lastName?: string | null;
}): string {
  const dni = String(params.dni ?? '')
    .replace(/\D/g, '')
    .slice(0, 12);
  const apellido = String(params.lastName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);

  if (dni && apellido) return `${dni}_${apellido}`;
  if (dni) return dni;
  return params.userId;
}
