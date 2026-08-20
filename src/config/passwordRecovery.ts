/** Tiempo de validez del OTP de recuperación (Supabase Auth; ajustable en dashboard). */
export const RECOVERY_OTP_TTL_MS = 60 * 60 * 1000;

/** Mínimo entre reenvíos (rate limit típico de Supabase Auth). */
export const RECOVERY_RESEND_COOLDOWN_MS = 60 * 1000;
