import { Linking } from 'react-native';
import { getPasswordRecoveryRedirectUrl } from '../config/authRedirect';
import { isSupabaseConfigured } from '../config/supabase';
import { getSupabaseClient } from '../lib/supabase';
import { fetchAuthUserFromSupabase } from './supabaseUser';
import type { AuthUser } from './auth';

type AuthFragment = {
  access_token?: string;
  refresh_token?: string;
  type?: string;
  token_hash?: string;
};

function extractParamString(url: string): string {
  const hashIdx = url.indexOf('#');
  const queryIdx = url.indexOf('?');
  if (hashIdx >= 0) return url.slice(hashIdx + 1);
  if (queryIdx >= 0) return url.slice(queryIdx + 1);
  return '';
}

/** Extrae parámetros del hash o query de un deep link / URL de Supabase Auth. */
export function parseSupabaseAuthFragment(url: string): AuthFragment | null {
  const paramString = extractParamString(url);
  if (!paramString) return null;

  const params = new URLSearchParams(paramString);
  const access_token = params.get('access_token') ?? undefined;
  const refresh_token = params.get('refresh_token') ?? undefined;
  const type = params.get('type') ?? undefined;
  const token_hash = params.get('token_hash') ?? params.get('token') ?? undefined;

  if (access_token) return { access_token, refresh_token, type, token_hash };
  if (token_hash) return { token_hash, type };
  return null;
}

export function isPasswordRecoveryDeepLink(url: string): boolean {
  const recoveryPath = getPasswordRecoveryRedirectUrl().replace(/\/+$/, '');
  const normalized = url.split('#')[0]?.split('?')[0] ?? url;
  if (normalized.startsWith(recoveryPath)) return true;
  if (normalized.includes('reset-password')) return true;
  if (url.includes('/auth/v1/verify') && url.includes('type=recovery')) return true;
  const fragment = parseSupabaseAuthFragment(url);
  return fragment?.type === 'recovery' || Boolean(fragment?.token_hash);
}

async function verifyRecoveryTokenHash(
  tokenHash: string,
): Promise<{ ok: true; email: string; user: AuthUser } | { ok: false; message: string }> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'recovery',
  });
  if (error) return { ok: false, message: error.message };

  const authUser = data.user ?? data.session?.user;
  const email = (authUser?.email ?? '').trim().toLowerCase();
  if (!email || !authUser) {
    return { ok: false, message: 'No pudimos identificar tu cuenta desde el enlace.' };
  }

  let profile: AuthUser = { id: authUser.id, email };
  try {
    profile = await fetchAuthUserFromSupabase(authUser);
  } catch {
    /* perfil opcional */
  }

  return { ok: true, email, user: profile };
}

/**
 * Intercambia tokens del enlace de recuperación por una sesión activa (setSession / verifyOtp).
 */
export async function establishSessionFromRecoveryLink(
  url: string,
): Promise<{ ok: true; email: string; user: AuthUser } | { ok: false; message: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Supabase no está configurado.' };
  }

  const fragment = parseSupabaseAuthFragment(url);
  if (!fragment) {
    return { ok: false, message: 'El enlace no contiene un token válido.' };
  }

  if (fragment.token_hash && !fragment.access_token) {
    try {
      return await verifyRecoveryTokenHash(fragment.token_hash);
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'No se pudo validar el enlace de recuperación.',
      };
    }
  }

  if (!fragment.access_token) {
    return { ok: false, message: 'El enlace no contiene un token válido.' };
  }
  if (fragment.type && fragment.type !== 'recovery') {
    return { ok: false, message: 'Este enlace no es de recuperación de contraseña.' };
  }

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.auth.setSession({
      access_token: fragment.access_token,
      refresh_token: fragment.refresh_token ?? '',
    });
    if (error) return { ok: false, message: error.message };

    const authUser = data.user ?? data.session?.user;
    const email = (authUser?.email ?? '').trim().toLowerCase();
    if (!email) {
      return { ok: false, message: 'No pudimos identificar tu cuenta desde el enlace.' };
    }

    let profile: AuthUser = { id: authUser!.id, email };
    try {
      profile = await fetchAuthUserFromSupabase(authUser!);
    } catch {
      /* perfil opcional */
    }

    return { ok: true, email, user: profile };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'No se pudo abrir el enlace de recuperación.',
    };
  }
}

/** Registra listener de deep links de recuperación; devuelve función de limpieza. */
export function subscribeToPasswordRecoveryDeepLinks(
  onRecovery: (result: { email: string; user: AuthUser }) => void,
  onError?: (message: string) => void,
): () => void {
  let handledInitial = false;

  async function handleUrl(url: string | null) {
    if (!url || !isPasswordRecoveryDeepLink(url)) return;
    const result = await establishSessionFromRecoveryLink(url);
    if (result.ok) onRecovery({ email: result.email, user: result.user });
    else onError?.(result.message);
  }

  void Linking.getInitialURL().then((url) => {
    if (handledInitial) return;
    handledInitial = true;
    void handleUrl(url);
  });

  const sub = Linking.addEventListener('url', ({ url }) => {
    void handleUrl(url);
  });

  return () => sub.remove();
}
