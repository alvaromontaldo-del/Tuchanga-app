const FOTO_EVENT = /^matricula:[0-9a-f-]{36}:[0-9a-f-]{36}:/i;

/**
 * Texto visible de la push de rechazo (#77).
 * Foto: la clave trae el id de la foto, o `kind = foto`.
 * Matrícula (oficio o legado): el resto.
 */
export function matriculaRechazoPushBody(input: {
  motivo: string;
  eventKey?: string | null;
  kind?: string | null;
}): string {
  const motivo = String(input.motivo ?? "").replace(/\s+/g, " ").trim();
  const kind = String(input.kind ?? "").trim().toLowerCase();
  const eventKey = String(input.eventKey ?? "").trim();
  const foto =
    kind === "foto" || (kind !== "matricula" && FOTO_EVENT.test(eventKey));
  if (foto) return `Algunas fotos de la verificación de la matrícula fueron rechazadas por el siguiente motivo: ${motivo}`;
  return `Tu matricula fue rechazada por el siguiente motivo: ${motivo}`;
}
