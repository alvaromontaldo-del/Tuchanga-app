import { isSupabaseConfigured } from '../config/supabase';
import { TERMS_VERSION } from '../constants/terms';
import { getSupabaseClient } from '../lib/supabase';
import {
  isTermsBackendUnavailable,
  type AcceptTermsResult,
  type TermsAcceptanceRow,
} from './termsAcceptanceRules';

export type { AcceptTermsResult, TermsAcceptanceRow };
export {
  dismissedKeyAfterAccept,
  isTermsBackendUnavailable,
  needsTermsAcceptance,
  termsPromptRequired,
  termsSessionKey,
} from './termsAcceptanceRules';

export type TermsReadResult =
  | { status: 'ok'; row: TermsAcceptanceRow | null }
  | { status: 'unavailable' }
  | { status: 'failed' };

/**
 * Guarda la versión vigente para auth.uid().
 * No lanza: si la tabla o el RPC todavía no están, devuelve `unavailable`.
 */
export async function acceptCurrentTerms(): Promise<AcceptTermsResult> {
  if (!isSupabaseConfigured()) return 'unavailable';
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.rpc('accept_terms', { p_version: TERMS_VERSION });
    if (!error) return 'saved';
    if (isTermsBackendUnavailable(error)) {
      console.warn(
        '[terms] accept_terms no está en la base. La app sigue sin bloquear.',
        error.message,
      );
      return 'unavailable';
    }
    console.warn('[terms] no se pudo guardar la aceptación:', error.message);
    return 'failed';
  } catch (e) {
    console.warn('[terms] accept_terms', e);
    return 'failed';
  }
}

/**
 * Lee solo la fila de auth.uid(). Si la tabla no está, `unavailable` (no bloquea).
 * Si la lectura falla por red, `failed` (tampoco bloquea, para no dejar el cartel en loop).
 */
export async function readMyTermsAcceptance(): Promise<TermsReadResult> {
  if (!isSupabaseConfigured()) return { status: 'unavailable' };
  try {
    const sb = getSupabaseClient();
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError || !authData.user?.id) {
      if (authError) console.warn('[terms] sesión:', authError.message);
      return { status: 'failed' };
    }

    const { data, error } = await sb
      .from('terms_acceptances')
      .select('accepted_at, terms_version')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    if (error) {
      if (isTermsBackendUnavailable(error)) {
        console.warn('[terms] la tabla de aceptación no está:', error.message);
        return { status: 'unavailable' };
      }
      console.warn('[terms] no se pudo leer la aceptación:', error.message);
      return { status: 'failed' };
    }

    return { status: 'ok', row: (data as TermsAcceptanceRow | null) ?? null };
  } catch (e) {
    console.warn('[terms] lectura de aceptación', e);
    return { status: 'failed' };
  }
}
