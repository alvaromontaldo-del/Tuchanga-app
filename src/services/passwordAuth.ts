/**
 * Gestión de contraseñas vía Supabase Auth.
 * - Cambio con sesión activa (re-auth + updateUser).
 * - Recuperación por OTP (resetPasswordForEmail + verifyOtp recovery).
 */

import { getPasswordRecoveryRedirectUrl } from '../config/authRedirect';
import { RECOVERY_RESEND_COOLDOWN_MS } from '../config/passwordRecovery';
import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import { fetchAuthUserFromSupabase } from './supabaseUser';
import type { AuthUser } from './auth';

function mapSupabaseAuthError(raw: string, code?: string, status?: number): string {
  const m = raw.toLowerCase();

  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    if (m.includes('once every') || m.includes('60 second')) {
      const secMatch = raw.match(/(\d+)\s*seconds?/i);
      return `Esperá ${secMatch?.[1] ?? '60'} segundos antes de pedir otro código.`;
    }
    return (
      'Límite de envío de emails de Supabase alcanzado (SMTP integrado: ~3–4 por hora en el proyecto). ' +
      'Esperá unos minutos o configurá SMTP propio en Supabase → Project Settings → Authentication → SMTP.'
    );
  }
  if (code === 'otp_disabled') {
    return 'La recuperación por código no está habilitada en Supabase (Authentication → Email).';
  }
  if (m.includes('redirect') && (m.includes('not allowed') || m.includes('invalid'))) {
    return (
      'La URL de redirección no está permitida en Supabase. ' +
      'Agregá tuchanga-app://reset-password en Authentication → URL configuration.'
    );
  }
  if (
    m.includes('invalid login') ||
    m.includes('invalid credentials') ||
    m.includes('wrong password')
  ) {
    return 'La contraseña anterior no es correcta.';
  }
  if (m.includes('same password') || m.includes('should be different')) {
    return 'La nueva contraseña debe ser distinta a la anterior.';
  }
  if (code === 'otp_expired' || m.includes('otp_expired') || (m.includes('token') && m.includes('expired'))) {
    return (
      'El código venció o ya fue usado. Pedí uno nuevo con «Reenviar código» ' +
      '(si abriste un enlace del mail antes, ese enlace pudo invalidarlo).'
    );
  }
  if (m.includes('token') && m.includes('invalid')) {
    return 'El código no es correcto. Revisá que sean solo números y que coincida con el último email.';
  }
  if (m.includes('email address not authorized') || code === 'email_address_not_authorized') {
    return 'No podemos enviar correos a esa dirección. Revisá SMTP / dominio en Supabase.';
  }
  return raw || 'No se pudo completar la operación.';
}

export type PasswordOpResult =
  | { ok: true; message: string; user?: AuthUser }
  | { ok: false; message: string; code?: 'email_not_registered' | 'rate_limited' };

/** Limpia sesión local antes de verifyOtp (no bloquea el envío del email). */
async function clearLocalAuthSessionForRecovery(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    await getSupabaseClient().auth.signOut({ scope: 'local' });
  } catch {
    /* ignore */
  }
}

type AuthLikeError = { message?: string; status?: number; code?: string };

function authErrorFields(error: AuthLikeError): { message: string; status?: number; code?: string } {
  return {
    message: error.message ?? '',
    status: error.status,
    code: error.code,
  };
}

/** Solo dígitos del OTP (evita espacios/guiones al copiar desde el mail). */
export function normalizeRecoveryOtp(raw: string): string {
  return raw.replace(/\D/g, '').trim();
}

/**
 * Consulta auth.users vía RPC security definer (solo boolean).
 * `null` = no se pudo verificar (RPC ausente o error de red).
 */
export async function isAuthEmailRegistered(email: string): Promise<boolean | null> {
  if (!isSupabaseConfigured()) return null;
  const em = email.trim().toLowerCase();
  if (!em) return false;

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.rpc('auth_email_is_registered', { p_email: em });
    if (error) {
      console.warn('[passwordAuth] auth_email_is_registered:', error.message);
      return null;
    }
    return Boolean(data);
  } catch {
    return null;
  }
}

async function sendRecoveryEmail(em: string): Promise<PasswordOpResult> {
  const sb = getSupabaseClient();
  const { error } = await sb.auth.resetPasswordForEmail(em, {
    redirectTo: getPasswordRecoveryRedirectUrl(),
  });
  if (error) {
    const { message, status, code } = authErrorFields(error);
    console.warn('[passwordAuth] resetPasswordForEmail:', message, status, code);
    const msg = mapSupabaseAuthError(message, code, status);
    const rateLimited =
      code === 'over_email_send_rate_limit' ||
      code === 'over_request_rate_limit' ||
      status === 429;
    return { ok: false, message: msg, code: rateLimited ? 'rate_limited' : undefined };
  }
  return {
    ok: true,
    message: 'Te enviamos un código de verificación a tu correo.',
  };
}

/**
 * Valida la contraseña actual con signInWithPassword y actualiza con updateUser.
 * Requiere email del usuario autenticado.
 */
export async function changePasswordWithReauth(params: {
  email: string;
  currentPassword: string;
  newPassword: string;
}): Promise<PasswordOpResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Conectá Supabase para cambiar la contraseña.' };
  }

  const email = params.email.trim().toLowerCase();
  if (!email) return { ok: false, message: 'No encontramos tu correo en la sesión.' };

  try {
    const sb = getSupabaseClient();

    const { error: signInError } = await sb.auth.signInWithPassword({
      email,
      password: params.currentPassword,
    });
    if (signInError) {
      const { message, status, code } = authErrorFields(signInError);
      return { ok: false, message: mapSupabaseAuthError(message, code, status) };
    }

    const { error: updateError } = await sb.auth.updateUser({
      password: params.newPassword,
    });
    if (updateError) {
      const { message, status, code } = authErrorFields(updateError);
      return { ok: false, message: mapSupabaseAuthError(message, code, status) };
    }

    return {
      ok: true,
      message: 'Tu contraseña se actualizó correctamente.',
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'No se pudo cambiar la contraseña.',
    };
  }
}

/**
 * Envía un código OTP al correo (plantilla de recuperación con token en Supabase).
 */
export async function requestPasswordRecoveryOtp(email: string): Promise<PasswordOpResult> {
  const em = email.trim().toLowerCase();
  if (!em) return { ok: false, message: 'Ingresá tu correo electrónico.' };

  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Conectá Supabase para recuperar la contraseña.' };
  }

  try {
    const registered = await isAuthEmailRegistered(em);
    if (registered === false) {
      return {
        ok: false,
        code: 'email_not_registered',
        message: 'No existe una cuenta registrada con ese correo electrónico.',
      };
    }
    if (registered === null) {
      return {
        ok: false,
        message:
          'No pudimos verificar tu correo. Ejecutá la migración auth_email_is_registered en Supabase o intentá más tarde.',
      };
    }

    return sendRecoveryEmail(em);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'No se pudo enviar el código.',
    };
  }
}

/**
 * Reenvía OTP sin volver a consultar la BD (paso 2; el email ya fue validado).
 */
export async function resendPasswordRecoveryOtp(email: string): Promise<PasswordOpResult> {
  const em = email.trim().toLowerCase();
  if (!em) return { ok: false, message: 'Falta el correo electrónico.' };

  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Conectá Supabase para recuperar la contraseña.' };
  }

  try {
    return sendRecoveryEmail(em);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'No se pudo reenviar el código.',
    };
  }
}

/** Cooldown sugerido tras reenvío exitoso (alineado al rate limit de Supabase). */
export function getRecoveryResendCooldownMs(): number {
  return RECOVERY_RESEND_COOLDOWN_MS;
}

/**
 * Verifica el OTP de recuperación (inicia sesión) y guarda la nueva contraseña.
 */
export async function verifyRecoveryOtpAndSetPassword(params: {
  email: string;
  token: string;
  newPassword: string;
}): Promise<PasswordOpResult> {
  const em = params.email.trim().toLowerCase();
  const token = normalizeRecoveryOtp(params.token);
  if (!em) return { ok: false, message: 'Falta el correo electrónico.' };
  if (!token) return { ok: false, message: 'Ingresá el código que recibiste por email.' };
  if (token.length < 6) {
    return { ok: false, message: 'El código debe tener al menos 6 dígitos.' };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Conectá Supabase para restablecer la contraseña.' };
  }

  try {
    const sb = getSupabaseClient();
    await clearLocalAuthSessionForRecovery();

    const { data, error: verifyError } = await sb.auth.verifyOtp({
      email: em,
      token,
      type: 'recovery',
    });
    if (verifyError) {
      const { message, status, code } = authErrorFields(verifyError);
      return { ok: false, message: mapSupabaseAuthError(message, code, status) };
    }

    const authUser = data.user;
    if (!authUser) {
      return { ok: false, message: 'No se pudo validar el código. Probá de nuevo.' };
    }

    const { error: updateError } = await sb.auth.updateUser({
      password: params.newPassword,
    });
    if (updateError) {
      const { message, status, code } = authErrorFields(updateError);
      return { ok: false, message: mapSupabaseAuthError(message, code, status) };
    }

    let profile: AuthUser = {
      id: authUser.id,
      email: (authUser.email ?? em).toLowerCase(),
    };
    try {
      profile = await fetchAuthUserFromSupabase(authUser);
    } catch {
      /* perfil opcional */
    }

    return {
      ok: true,
      message: 'Contraseña actualizada. Ya podés usar la app con tu nueva clave.',
      user: profile,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'No se pudo restablecer la contraseña.',
    };
  }
}

/**
 * Tras abrir el enlace del email (sesión recovery ya activa), solo guarda la nueva clave.
 */
export async function setPasswordFromActiveRecoverySession(
  newPassword: string,
): Promise<PasswordOpResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Conectá Supabase para restablecer la contraseña.' };
  }

  try {
    const sb = getSupabaseClient();
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session?.user) {
      return {
        ok: false,
        message: 'El enlace venció o no es válido. Pedí un código nuevo.',
      };
    }

    const { error: updateError } = await sb.auth.updateUser({ password: newPassword });
    if (updateError) {
      const { message, status, code } = authErrorFields(updateError);
      return { ok: false, message: mapSupabaseAuthError(message, code, status) };
    }

    const authUser = session.user;
    const email = (authUser.email ?? '').toLowerCase();
    let profile: AuthUser = { id: authUser.id, email };
    try {
      profile = await fetchAuthUserFromSupabase(authUser);
    } catch {
      /* perfil opcional */
    }

    return {
      ok: true,
      message: 'Contraseña actualizada. Ya podés usar la app con tu nueva clave.',
      user: profile,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'No se pudo restablecer la contraseña.',
    };
  }
}
