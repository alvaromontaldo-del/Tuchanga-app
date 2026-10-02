import { isSupabaseConfigured } from '../config/supabase';
import { TERMS_VERSION } from '../constants/terms';
import { getSupabaseClient } from '../lib/supabase';
import {
  isTermsBackendUnavailable,
  needsTermsAcceptance,
  type TermsAcceptanceRow,
} from './termsAcceptanceRules';

export type { TermsAcceptanceRow };
export { isTermsBackendUnavailable, needsTermsAcceptance };

export type AcceptTermsResult = 'saved' | 'unavailable' | 'failed';

/**
 * Guarda la versión vigente para auth.uid() (perfil y comercios de esa cuenta).
 * No lanza: un RPC o columnas ausentes devuelven `unavailable`.
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
 * true solo cuando el perfil existe y no aceptó esta versión.
 * Si faltan columnas o la lectura falla, devuelve false (no bloquea).
 */
export async function termsAcceptanceRequired(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const sb = getSupabaseClient();
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError || !authData.user?.id) {
      if (authError) console.warn('[terms] sesión:', authError.message);
      return false;
    }

    const { data, error } = await sb
      .from('profiles')
      .select('terms_accepted_at, terms_version')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (error) {
      if (isTermsBackendUnavailable(error)) {
        console.warn('[terms] columnas de aceptación no disponibles:', error.message);
      } else {
        console.warn('[terms] no se pudo leer la aceptación:', error.message);
      }
      return false;
    }

    return needsTermsAcceptance(data as TermsAcceptanceRow | null, TERMS_VERSION);
  } catch (e) {
    console.warn('[terms] lectura de aceptación', e);
    return false;
  }
}
