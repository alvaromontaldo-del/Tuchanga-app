/**
 * Texto de la ficha profesional. Vive solo en profiles.professional_description.
 * Si todavía no hay texto, se muestra el detalle del oficio.
 */
export function resolveProfessionalDescription(input: {
  professionalDescription?: string | null;
  tradeFallback?: string | null;
}): string | undefined {
  const written = (input.professionalDescription ?? '').trim();
  if (written) return written;
  const trade = (input.tradeFallback ?? '').trim();
  return trade || undefined;
}
