/**
 * Texto que el alta profesional tiene que dejar en el perfil.
 * `update_profile_registration_full` no escribe bio ni professional_description.
 * Si una de las dos columnas sí se guardó, hay que mostrarla igual.
 */
export function resolveAccountBio(input: {
  professionalDescription?: string | null;
  bio?: string | null;
  tradeFallback?: string | null;
}): string | undefined {
  const written =
    (input.professionalDescription ?? '').trim() || (input.bio ?? '').trim();
  if (written) return written;
  const trade = (input.tradeFallback ?? '').trim();
  return trade || undefined;
}

/** Las dos columnas que leen la ficha pública y Editar perfil. */
export function professionalDescriptionColumns(text: string): {
  professional_description: string;
  bio: string;
} {
  const trimmed = text.trim();
  return { professional_description: trimmed, bio: trimmed };
}
