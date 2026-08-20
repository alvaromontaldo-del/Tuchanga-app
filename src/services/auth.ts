/**
 * Autenticación: Supabase (si está configurado) o mock local para UI sin backend.
 */

import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import { newRandomUserId, stableUserIdFromEmail } from '../utils/stableUserId';
import { userAuthDisplayName } from '../utils/storageOwnerFolder';
import { calcAgeFromBirthDate, parseBirthDateParts } from '../utils/birthDate';
import {
  clearPendingProfileSignup,
  savePendingProfileSignup,
  tryApplyPendingProfileSignup,
} from './pendingProfileSignup';
import { fetchAuthUserFromSupabase, persistSignUpToSupabase } from './supabaseUser';

const MOCK_DELAY_MS = 900;
/** Cobertura de varias idas a Auth (cada fetch tiene su propio tope en `supabaseFetch`). */
const SUPABASE_SIGNIN_TIMEOUT_MS = 75_000;
/** Perfil/jobs en BD: si tarda o falla (RLS/red), igual dejamos entrar con usuario mínimo. */
const SUPABASE_PROFILE_FETCH_TIMEOUT_MS = 25_000;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/** Mensajes de Supabase Auth más claros en español. */
function mapSupabaseSignInError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('email not confirmed') || m.includes('not confirmed')) {
    return 'Tenés que confirmar el correo antes de ingresar. Revisá tu bandeja (y spam) o pedí un nuevo mail desde Supabase.';
  }
  if (
    m.includes('invalid login') ||
    m.includes('invalid credentials') ||
    m.includes('wrong password') ||
    m.includes('invalid email or password')
  ) {
    return 'Email o contraseña incorrectos.';
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
  }
  return raw;
}

/** Errores de registro (email/DNI/celular duplicados, etc.). */
function mapSupabaseSignUpError(raw: string): string {
  const m = raw.toLowerCase();
  if (
    m.includes('user already registered') ||
    m.includes('already been registered') ||
    m.includes('email address is already') ||
    m.includes('email already') ||
    (m.includes('duplicate') && m.includes('email'))
  ) {
    return MSG_IDENTITY.email;
  }
  if (
    m.includes('profiles_dni') ||
    (m.includes('duplicate') && m.includes('dni')) ||
    (m.includes('unique') && m.includes('dni'))
  ) {
    return MSG_IDENTITY.dni;
  }
  if (
    m.includes('profiles_telefono') ||
    m.includes('profile_phone') ||
    ((m.includes('duplicate') || m.includes('unique')) &&
      (m.includes('telefono') || m.includes('phone') || m.includes('celular')))
  ) {
    return MSG_IDENTITY.phone;
  }
  if (m.includes('correo o dni ya se encuentra') || m.includes('ya está registrado')) {
    return raw;
  }
  if (m.includes('too many requests') || m.includes('rate limit') || m.includes('over_email')) {
    return 'Demasiados intentos de registro. Esperá unos minutos y probá de nuevo.';
  }
  return raw;
}

export type IdentityField = 'email' | 'dni' | 'phone';

export const MSG_IDENTITY = {
  email:
    'No se pudo crear la cuenta: este correo ya está registrado. Probá ingresar o recuperá tu contraseña.',
  dni: 'No se pudo crear la cuenta: este DNI ya está registrado.',
  phone: 'No se pudo crear la cuenta: este celular ya está registrado.',
} as const;

/** Mensajes cortos para el campo del formulario. */
export const MSG_IDENTITY_FIELD = {
  email: 'Este correo ya está registrado.',
  dni: 'Este DNI ya está registrado.',
  phone: 'Este celular ya está registrado.',
} as const;

export type IdentityConflict = { field: IdentityField; message: string };

function normalizePhoneDigitsForCompare(phone: string): string {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.startsWith('54')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

/**
 * Chequea email / DNI / celular ya usados. Devuelve el primer conflicto (prioridad: email → DNI → celular).
 */
export async function checkIdentityConflicts(params: {
  email?: string;
  dni?: string;
  phone?: string;
}): Promise<IdentityConflict | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabaseClient();
  const email = (params.email ?? '').trim().toLowerCase();
  const dniDigits = (params.dni ?? '').replace(/\D/g, '');
  const phoneDigits = normalizePhoneDigitsForCompare(params.phone ?? '');

  const checks: Array<Promise<IdentityConflict | null>> = [];

  if (email) {
    checks.push(
      (async () => {
        const { data, error } = await sb.rpc('auth_email_is_registered', { p_email: email });
        if (!error && data === true) return { field: 'email' as const, message: MSG_IDENTITY.email };
        return null;
      })(),
    );
  }
  if (dniDigits.length >= 7) {
    checks.push(
      (async () => {
        const { data, error } = await sb.rpc('profile_dni_is_registered', { p_dni: dniDigits });
        if (!error && data === true) return { field: 'dni' as const, message: MSG_IDENTITY.dni };
        return null;
      })(),
    );
  }
  if (phoneDigits.length >= 8) {
    checks.push(
      (async () => {
        const { data, error } = await sb.rpc('profile_phone_is_registered', {
          p_phone: phoneDigits,
        });
        if (!error && data === true) return { field: 'phone' as const, message: MSG_IDENTITY.phone };
        return null;
      })(),
    );
  }

  const results = await Promise.all(checks);
  const order: IdentityField[] = ['email', 'dni', 'phone'];
  for (const field of order) {
    const hit = results.find((r) => r?.field === field);
    if (hit) return hit;
  }
  return null;
}

async function assertIdentityAvailable(
  email: string,
  dni: string,
  phone: string,
): Promise<IdentityConflict | null> {
  return checkIdentityConflicts({ email, dni, phone });
}

function identityFieldFromMessage(message: string): IdentityField | undefined {
  const m = message.toLowerCase();
  if (m.includes('correo') || m.includes('email') || m.includes('e-mail')) return 'email';
  if (m.includes('dni')) return 'dni';
  if (m.includes('celular') || m.includes('teléfono') || m.includes('telefono') || m.includes('phone')) {
    return 'phone';
  }
  return undefined;
}

function isLikelyAbortError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') {
    return true;
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError') return true;
    return /abort/i.test(e.message);
  }
  return false;
}

const MSG_RED_SUPABASE =
  'Tu red no recibió respuesta a tiempo desde Supabase. Probá otra WiFi o datos móviles, sin VPN, y que el antivirus no filtre HTTPS. En el navegador abrí la URL de tu proyecto + /auth/v1/health (debe responder). En el dashboard de Supabase comprobá que el proyecto no esté pausado.';

export type WorkerTradeDraft = {
  id: string;
  name: string;
  details: string;
  proofImageUri?: string;
  proofImageUris?: string[];
  rubroSlug?: string;
};

export type AuthUser = {
  /** UUID para chat / API */
  id: string;
  email: string;

  firstName?: string;
  lastName?: string;
  fullName?: string;
  dni?: string;
  avatarUri?: string;
  phone?: string;

  baseLocation?: {
    address: string;
    lat: number;
    lng: number;
  };

  /** Referencias opcionales para ubicar el domicilio (rejas, color de pared, etc.). */
  locationDetails?: string;

  worker?: {
    coverageKm: number;
    primaryTradeName: string;
    trades: Array<{
      id: string;
      name: string;
      details: string;
      proofImageUri?: string;
      proofImageUris?: string[];
      rubroSlug?: string;
      isPrimary: boolean;
    }>;
  };

  location?: string;

  /** ISO 8601 desde `profiles.created_at` (Supabase). */
  profileCreatedAt?: string;
  /** Texto corto para mostrar en perfil (oficio principal u opcional en el futuro). */
  bio?: string;

  /** Rating acumulado (para mostrar estrellas en Mi Perfil). */
  ratingAverage?: number;
  /** Cantidad de reseñas acumuladas. */
  reviewCount?: number;

  /** Fecha de nacimiento ISO (YYYY-MM-DD) */
  birthDate?: string;
};

export type AuthFailureReason = 'error' | 'email_confirmation' | 'identity_taken';

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; message: string; reason?: AuthFailureReason; field?: IdentityField };

export type SignUpPayload = {
  firstName: string;
  lastName: string;
  dni: string;
  avatarUri: string;
  email: string;
  password: string;
  phone: string;
  baseLocation: { address: string; lat: number; lng: number };
  /** Referencias opcionales para ubicar el domicilio. */
  locationDetails?: string;
  /** YYYY-MM-DD */
  birthDate: string;

  offerServices: boolean;
  coverageKm?: number;
  trades?: WorkerTradeDraft[];
  primaryTradeId?: string;
  /** Descripción profesional (obligatorio si ofrecés servicios), máx. 500 caracteres. Se persiste como bio en perfil. */
  bio?: string;
};

function validateSignUpPayload(payload: SignUpPayload): string | null {
  const first = payload.firstName.trim();
  const last = payload.lastName.trim();
  const dni = payload.dni.trim();
  const avatarUri = payload.avatarUri.trim();
  const email = payload.email.trim().toLowerCase();
  const phone = payload.phone.trim();
  const address = payload.baseLocation?.address?.trim();
  const birth = (payload.birthDate ?? '').trim();

  if (!first || !last || !email || !dni || !avatarUri) {
    return 'Completá todos los campos obligatorios.';
  }
  if (!birth) {
    return 'Completá tu fecha de nacimiento.';
  }
  if (!parseBirthDateParts(birth)) {
    return 'Ingresá tu fecha de nacimiento con formato AAAA-MM-DD.';
  }
  const age = calcAgeFromBirthDate(birth);
  if (age == null) return 'Ingresá una fecha de nacimiento válida.';
  if (age < 18) return 'Debés ser mayor de 18 años.';
  if (dni.length < 7 || dni.length > 9) {
    return 'Ingresá un DNI válido.';
  }
  if (!phone) {
    return 'Completá el teléfono.';
  }
  if (!address) {
    return 'Seleccioná una dirección.';
  }
  if (!payload.password || payload.password.length < 6) {
    return 'La contraseña es demasiado corta.';
  }

  const bio = (payload.bio ?? '').trim();
  if (bio.length > 500) {
    return 'La descripción profesional no puede superar los 500 caracteres.';
  }

  if (payload.offerServices) {
    if (bio.length < 20) {
      return 'La descripción profesional es obligatoria (mínimo 20 caracteres).';
    }
    const km = Math.floor(Number(payload.coverageKm) || 0);
    if (km < 1) return 'Ingresá un radio de cobertura válido.';
    const trades = payload.trades ?? [];
    if (trades.length < 1 || trades.length > 5) {
      return 'Elegí entre 1 y 5 oficios.';
    }
    if (!payload.primaryTradeId) {
      return 'Marcá un oficio principal.';
    }
    const primary = trades.find((t) => t.id === payload.primaryTradeId);
    if (!primary?.name?.trim()) {
      return 'El oficio principal no es válido.';
    }
  }

  return null;
}

/** Si el fetch del perfil falla tras un insert correcto, armamos el usuario desde el formulario (misma forma que el mock). */
function buildAuthUserFromSignUpPayload(
  authUser: User,
  persistPayload: Omit<SignUpPayload, 'password' | 'email'>,
): AuthUser {
  const email = (authUser.email ?? '').toLowerCase();
  const first = persistPayload.firstName.trim();
  const last = persistPayload.lastName.trim();
  const worker =
    persistPayload.offerServices &&
    persistPayload.coverageKm != null &&
    persistPayload.trades?.length &&
    persistPayload.primaryTradeId
      ? (() => {
          const primary = persistPayload.trades.find(
            (t) => t.id === persistPayload.primaryTradeId,
          )!;
          return {
            coverageKm: Math.floor(Number(persistPayload.coverageKm) || 0),
            primaryTradeName: primary.name.trim(),
            trades: persistPayload.trades.map((t) => ({
              id: t.id,
              name: t.name.trim(),
              details: t.details.trim(),
              proofImageUri: t.proofImageUri,
              rubroSlug: t.rubroSlug,
              isPrimary: t.id === persistPayload.primaryTradeId,
            })),
          };
        })()
      : undefined;
  const bio = (persistPayload.bio ?? '').trim() || undefined;
  return {
    id: authUser.id,
    email,
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`.trim(),
    dni: persistPayload.dni.trim(),
    avatarUri: persistPayload.avatarUri.trim(),
    phone: persistPayload.phone.trim(),
    baseLocation: {
      address: persistPayload.baseLocation.address.trim(),
      lat: persistPayload.baseLocation.lat,
      lng: persistPayload.baseLocation.lng,
    },
    bio,
    worker,
  };
}

const registeredEmails = new Set<string>();

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const em = email.trim().toLowerCase();

  if (isSupabaseConfigured()) {
    if (!em) return { ok: false, message: 'Ingresá un email válido.' };
    if (!password) return { ok: false, message: 'Ingresá tu contraseña.' };
    try {
      const sb = getSupabaseClient();

      const signInOnly = async (): Promise<User> => {
        const { data, error } = await sb.auth.signInWithPassword({ email: em, password });
        if (error) {
          throw new Error(mapSupabaseSignInError(error.message));
        }
        if (!data.user) {
          throw new Error('No se pudo iniciar sesión. Probá de nuevo.');
        }
        if (!data.session) {
          const { data: refetched } = await sb.auth.getSession();
          if (!refetched.session) {
            throw new Error(
              'Tu cuenta no tiene sesión activa todavía. Si Supabase exige confirmar el email, revisá tu correo. En desarrollo podés desactivar “Confirm email” en Authentication → Providers → Email.',
            );
          }
        }
        return data.user;
      };

      let authUser: User;
      try {
        authUser = await Promise.race([
          signInOnly(),
          rejectAfter(
            SUPABASE_SIGNIN_TIMEOUT_MS,
            'La conexión tardó demasiado. Revisá tu red, la URL de Supabase en .env y probá de nuevo.',
          ),
        ]);
      } catch (e) {
        if (isLikelyAbortError(e)) {
          return { ok: false, message: MSG_RED_SUPABASE };
        }
        return { ok: false, message: e instanceof Error ? e.message : 'Error de inicio de sesión.' };
      }

      await tryApplyPendingProfileSignup(authUser.id);

      try {
        const user = await Promise.race([
          fetchAuthUserFromSupabase(authUser),
          rejectAfter(
            SUPABASE_PROFILE_FETCH_TIMEOUT_MS,
            'El perfil tardó demasiado; entrás con datos básicos.',
          ),
        ]);
        return { ok: true, user };
      } catch {
        return {
          ok: true,
          user: {
            id: authUser.id,
            email: (authUser.email ?? em).toLowerCase(),
          },
        };
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Error de inicio de sesión.' };
    }
  }

  await delay(MOCK_DELAY_MS);
  if (!em) {
    return { ok: false, message: 'Ingresá un email válido.' };
  }
  return { ok: true, user: { id: stableUserIdFromEmail(em), email: em } };
}

export async function signUp(payload: SignUpPayload): Promise<AuthResult> {
  const err = validateSignUpPayload(payload);
  if (err) return { ok: false, message: err };

  const email = payload.email.trim().toLowerCase();

  if (isSupabaseConfigured()) {
    try {
      const sb = getSupabaseClient();

      const conflict = await assertIdentityAvailable(email, payload.dni, payload.phone);
      if (conflict) {
        return {
          ok: false,
          reason: 'identity_taken',
          field: conflict.field,
          message: conflict.message,
        };
      }

      const displayLabel = userAuthDisplayName({
        dni: payload.dni,
        lastName: payload.lastName,
      });
      const phoneDigits = String(payload.phone ?? '').replace(/\D/g, '');
      const meta: Record<string, string> = {};
      if (displayLabel) {
        meta.display_name = displayLabel;
        meta.full_name = displayLabel;
        meta.name = displayLabel;
      }
      if (phoneDigits.length >= 8) {
        meta.phone = phoneDigits.startsWith('54') ? `+${phoneDigits}` : `+54${phoneDigits.replace(/^0/, '')}`;
      }
      if (payload.birthDate?.trim()) {
        meta.birth_date = payload.birthDate.trim();
      }
      const { data, error } = await sb.auth.signUp({
        email,
        password: payload.password,
        options: {
          data: meta,
        },
      });
      if (error) {
        const message = mapSupabaseSignUpError(error.message);
        return {
          ok: false,
          reason: identityFieldFromMessage(message) ? 'identity_taken' : 'error',
          field: identityFieldFromMessage(message),
          message,
        };
      }
      const uid = data.user?.id;
      // Supabase a veces “responde OK” con identities vacío cuando el email ya existe
      // (no revela si el correo está tomado). Lo tratamos como email duplicado.
      const identities = data.user?.identities;
      if (uid && Array.isArray(identities) && identities.length === 0) {
        return {
          ok: false,
          reason: 'identity_taken',
          field: 'email',
          message: MSG_IDENTITY.email,
        };
      }
      if (!uid) {
        return {
          ok: false,
          reason: 'email_confirmation',
          message:
            '¡Felicitaciones! Revisá tu correo y validá el enlace de confirmación antes de ingresar.',
        };
      }
      if (!data.session) {
        await savePendingProfileSignup(uid, payload);
        return {
          ok: false,
          reason: 'email_confirmation',
          message:
            '¡Felicitaciones! Tu cuenta fue creada. Revisá tu correo y validá el enlace que te enviamos; después ingresá con tu email y contraseña. Al entrar por primera vez guardamos tu perfil automáticamente.',
        };
      }
      const authUser = data.user;
      if (!authUser) {
        return { ok: false, message: 'No se pudo obtener el usuario recién creado.' };
      }
      const { password: _p, email: _e, ...persistPayload } = payload;
      try {
        await persistSignUpToSupabase(persistPayload, uid);
        await clearPendingProfileSignup();
      } catch (e) {
        await savePendingProfileSignup(uid, payload);
        const raw = e instanceof Error ? e.message : 'No se pudo guardar el perfil. Volvé a intentar o ingresá más tarde.';
        const message = mapSupabaseSignUpError(raw);
        return {
          ok: false,
          reason: identityFieldFromMessage(message) ? 'identity_taken' : 'error',
          field: identityFieldFromMessage(message),
          message,
        };
      }
      try {
        const user = await Promise.race([
          fetchAuthUserFromSupabase(authUser),
          rejectAfter(
            SUPABASE_PROFILE_FETCH_TIMEOUT_MS,
            'El perfil tardó demasiado; entrás con los datos del registro.',
          ),
        ]);
        return { ok: true, user };
      } catch {
        return { ok: true, user: buildAuthUserFromSignUpPayload(authUser, persistPayload) };
      }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'No se pudo completar el registro.',
      };
    }
  }

  await delay(MOCK_DELAY_MS);

  if (registeredEmails.has(email)) {
    return { ok: false, message: 'Ese email ya está registrado.' };
  }

  registeredEmails.add(email);

  const first = payload.firstName.trim();
  const last = payload.lastName.trim();
  const fullName = `${first} ${last}`.trim();
  const address = payload.baseLocation.address.trim();

  const worker =
    payload.offerServices && payload.coverageKm && payload.trades && payload.primaryTradeId
      ? (() => {
          const primary = payload.trades!.find((t) => t.id === payload.primaryTradeId)!;
          const normalizedTrades = payload.trades!.map((t) => ({
            id: t.id,
            name: t.name.trim(),
            details: t.details.trim(),
            proofImageUri: t.proofImageUri,
            rubroSlug: t.rubroSlug,
            isPrimary: t.id === payload.primaryTradeId,
          }));
          return {
            coverageKm: Math.floor(payload.coverageKm!),
            primaryTradeName: primary.name.trim(),
            trades: normalizedTrades,
          };
        })()
      : undefined;

  const bioMock = (payload.bio ?? '').trim() || undefined;

  return {
    ok: true,
    user: {
      id: newRandomUserId(),
      email,
      firstName: first,
      lastName: last,
      fullName,
      dni: payload.dni.trim(),
      avatarUri: payload.avatarUri.trim(),
      phone: payload.phone.trim(),
      baseLocation: {
        address,
        lat: payload.baseLocation.lat,
        lng: payload.baseLocation.lng,
      },
      worker,
      location: address,
      bio: bioMock,
    },
  };
}

export async function requestPasswordReset(
  email: string,
): Promise<{ ok: boolean; message: string }> {
  const em = email.trim();
  if (!em) {
    return { ok: false, message: 'Ingresá tu correo electrónico.' };
  }

  if (isSupabaseConfigured()) {
    try {
      const sb = getSupabaseClient();
      const { error } = await sb.auth.resetPasswordForEmail(em);
      if (error) return { ok: false, message: error.message };
      return {
        ok: true,
        message: 'Si el correo está registrado, recibirás un enlace para restablecer la contraseña.',
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Error al solicitar el enlace.' };
    }
  }

  await delay(MOCK_DELAY_MS);
  return {
    ok: true,
    message: 'Si el correo está registrado, recibirás instrucciones en breve.',
  };
}
