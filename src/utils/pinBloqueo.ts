/** Intentos fallidos antes de bloquear el PIN del trabajo. Lo fija `verificar_pin`. */
export const PIN_MAX_INTENTOS = 5;

const ZONA_BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const LOCK_RE = /pin_bloqueado|pin bloqueado temporalmente/i;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/;

export class PinBloqueadoError extends Error {
  readonly hasta: Date | null;

  constructor(hasta: Date | null) {
    super(
      hasta
        ? mensajePinBloqueado(hasta)
        : 'Pusiste mal el PIN 5 veces. Esperá 15 minutos para volver a intentarlo.',
    );
    this.name = 'PinBloqueadoError';
    this.hasta = hasta;
  }
}

export function parsePinBloqueadoHasta(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/** HH:MM en hora de Buenos Aires, sin fecha. */
export function horaBuenosAires(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_BUENOS_AIRES,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function mensajePinBloqueado(hasta: Date): string {
  return `Pusiste mal el PIN 5 veces. Esperá 15 minutos para volver a intentarlo (hasta las ${horaBuenosAires(hasta)}).`;
}

export function intentosRestantesPin(fallidos: number): number {
  if (!Number.isFinite(fallidos) || fallidos <= 0) return PIN_MAX_INTENTOS;
  return Math.max(0, PIN_MAX_INTENTOS - Math.floor(fallidos));
}

function errorParts(error: unknown): { message: string; details: string } {
  if (typeof error === 'string') return { message: error, details: '' };
  if (!error || typeof error !== 'object') return { message: '', details: '' };
  const row = error as { message?: unknown; details?: unknown };
  const message =
    typeof row.message === 'string'
      ? row.message
      : error instanceof Error
        ? error.message
        : '';
  const details = typeof row.details === 'string' ? row.details : '';
  return { message, details };
}

/** El RPC tira `pin_bloqueado` (o el texto viejo) y la hora va en DETAIL. */
export function pinBloqueadoDesdeRpc(error: unknown): { hasta: Date | null } | null {
  if (error instanceof PinBloqueadoError) return { hasta: error.hasta };
  const { message, details } = errorParts(error);
  if (!LOCK_RE.test(message) && !LOCK_RE.test(details)) return null;
  const iso = details.match(ISO_RE)?.[0] ?? message.match(ISO_RE)?.[0] ?? null;
  return { hasta: parsePinBloqueadoHasta(iso) ?? parsePinBloqueadoHasta(details) };
}

export function mensajeErrorRpc(error: unknown, fallback: string): string {
  const message = errorParts(error).message.trim();
  return message || fallback;
}

export type ResultadoVerificacionPin =
  | { type: 'ok' }
  | { type: 'bloqueado'; message: string; hasta: Date | null }
  | { type: 'incorrecto'; message: string }
  | { type: 'error'; message: string };

/**
 * El 5º fallo devuelve false y deja `pin_bloqueado_hasta` en la fila
 * (un RAISE después del UPDATE desharía el bloqueo). Los intentos
 * siguientes, con el bloqueo vigente, sí vienen como error.
 */
export function resultadoVerificacionPin(input: {
  ok: boolean | null;
  error?: unknown;
  pinIntentosFallidos?: number | null;
  pinBloqueadoHasta?: unknown;
  now?: number;
}): ResultadoVerificacionPin {
  const now = input.now ?? Date.now();
  const desdeError = input.error != null ? pinBloqueadoDesdeRpc(input.error) : null;
  const hastaFila = parsePinBloqueadoHasta(input.pinBloqueadoHasta);
  const filaVigente = hastaFila != null && hastaFila.getTime() > now;
  if (desdeError || filaVigente) {
    const hasta = desdeError?.hasta ?? (filaVigente ? hastaFila : null);
    return {
      type: 'bloqueado',
      hasta,
      message: hasta ? mensajePinBloqueado(hasta) : new PinBloqueadoError(null).message,
    };
  }
  if (input.error != null) {
    return {
      type: 'error',
      message: mensajeErrorRpc(input.error, 'No se pudo verificar el PIN'),
    };
  }
  if (input.ok) return { type: 'ok' };
  if (input.pinIntentosFallidos == null || !Number.isFinite(input.pinIntentosFallidos)) {
    return { type: 'incorrecto', message: 'PIN incorrecto' };
  }
  const quedan = intentosRestantesPin(input.pinIntentosFallidos);
  if (quedan === 1) {
    return { type: 'incorrecto', message: 'PIN incorrecto. Te queda 1 intento.' };
  }
  if (quedan > 1) {
    return {
      type: 'incorrecto',
      message: `PIN incorrecto. Te quedan ${quedan} intentos.`,
    };
  }
  return { type: 'incorrecto', message: 'PIN incorrecto' };
}
