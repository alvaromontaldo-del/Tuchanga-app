export type JobAddressCardMode = 'hidden' | 'confirm' | 'change';

export type JobAddressRejection = 'not_client' | 'paid' | 'invalid';

const PAID = new Set(['seña_pagada', 'totalmente_pagado']);

/** La dirección del trabajo se traba cuando ya se pagó la seña o el total. */
export function isJobAddressPaid(estadoPago: string | null | undefined): boolean {
  return PAID.has(estadoPago ?? '');
}

/**
 * La tarjeta es solo del cliente. Después del pago desaparece.
 * Confirmada y sin pago: queda el link para cambiarla.
 */
export function jobAddressCardMode(input: {
  role: 'cliente' | 'trabajador' | null | undefined;
  paid: boolean;
  confirmed: boolean;
}): JobAddressCardMode {
  if (input.role !== 'cliente' || input.paid) return 'hidden';
  return input.confirmed ? 'change' : 'confirm';
}

/**
 * Misma puerta que `set_conversation_job_address`: cliente de un chat
 * vigente, sin pago, texto y un punto real (ni 0,0 ni fuera de rango).
 */
export function jobAddressWriteRejection(input: {
  isClient: boolean;
  deleted: boolean;
  paid: boolean;
  text: string;
  lat: number | null;
  lng: number | null;
}): JobAddressRejection | null {
  if (!input.isClient || input.deleted) return 'not_client';
  if (input.paid) return 'paid';
  const text = input.text.trim();
  const lat = input.lat;
  const lng = input.lng;
  if (
    !text ||
    text.length > 300 ||
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return 'invalid';
  }
  return null;
}

/** Texto que ve el cliente. Nunca coordenadas. */
export function visibleJobAddressLabel(
  jobText: string | null | undefined,
  profileText: string | null | undefined,
): string {
  const job = (jobText ?? '').replace(/\s+/g, ' ').trim();
  if (job) return job;
  return (profileText ?? '').replace(/\s+/g, ' ').trim();
}
