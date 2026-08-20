import { getSupabaseClient } from '../lib/supabase';

/**
 * Solo errores que indican usuario borrado / token definitivamente inválido.
 * NO incluir 401/403 genéricos ni "jwt expired" (eso se resuelve con refresh).
 */
export function isDeletedOrInvalidAuthError(err: unknown): boolean {
  const msg = (
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : String(err ?? '')
  ).toLowerCase();

  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code?: unknown }).code ?? '').toLowerCase()
      : '';

  return (
    msg.includes('user from sub claim in jwt does not exist') ||
    msg.includes('user not found') ||
    msg.includes('user_not_found') ||
    code === 'user_not_found' ||
    msg.includes('refresh_token_not_found') ||
    code === 'refresh_token_not_found'
  );
}

/**
 * Chequeo liviano para background / restore.
 * Solo expulsa si Auth confirma que el usuario ya no existe.
 * No hace refreshSession ni exige fila en profiles (evita falsos positivos en iOS).
 */
export async function validateRemoteAccount(sessionUserId: string): Promise<boolean> {
  const sb = getSupabaseClient();
  try {
    const {
      data: { user: authUser },
      error,
    } = await sb.auth.getUser();

    if (error) {
      // Solo outs definitivos; red / timeouts / JWT por refrescar → seguir.
      if (isDeletedOrInvalidAuthError(error)) return false;
      return true;
    }
    if (!authUser) return false;
    if (authUser.id !== sessionUserId) return false;
    return true;
  } catch (e) {
    if (isDeletedOrInvalidAuthError(e)) return false;
    return true;
  }
}

/**
 * Chequeo al contactar / acción sensible.
 * Si Auth OK pero no hay perfil, la cuenta fue eliminada de la DB.
 */
export async function validateAccountForAction(sessionUserId: string): Promise<boolean> {
  const authOk = await validateRemoteAccount(sessionUserId);
  if (!authOk) return false;

  const sb = getSupabaseClient();
  try {
    const { data: profile, error: pe } = await sb
      .from('profiles')
      .select('id')
      .eq('id', sessionUserId)
      .maybeSingle();

    // Error de lectura/red: no expulsamos.
    if (pe) return true;
    return Boolean(profile?.id);
  } catch {
    return true;
  }
}
