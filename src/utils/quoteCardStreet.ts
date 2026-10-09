/**
 * La calle del cliente en la tarjeta de presupuesto.
 * Misma puerta que «Dirección del cliente» en el detalle del servicio:
 * solo el profesional, con el costo de servicio ya pago y la agenda confirmada.
 */

const ESTADOS_CON_CALLE = ['aceptado', 'en_curso', 'pendiente_conformidad'] as const;

export function canShowQuoteStreet(input: {
  role: string | null | undefined;
  quoteId: string | null | undefined;
  jobId: string | null | undefined;
  estadoPago: string | null | undefined;
  estadoTrabajo: string | null | undefined;
  fechaTrabajo: string | null | undefined;
}): boolean {
  if (input.role !== 'trabajador') return false;
  if (!input.quoteId || !input.jobId || input.quoteId !== input.jobId) return false;
  if (!input.estadoPago || input.estadoPago === 'pendiente_seña') return false;
  if (!input.fechaTrabajo) return false;
  return (ESTADOS_CON_CALLE as readonly string[]).includes(input.estadoTrabajo ?? '');
}
