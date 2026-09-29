/**
 * Baja de cuenta (ticket #83).
 *
 * GoTrue marca `user_banned` antes de validar la contraseña. La RPC
 * `get_my_deactivation_reason` sí verifica la clave: si devuelve
 * `invalid_credentials` no hay que revelar el motivo.
 */

export const REACTIVATION_EMAIL = 'yachanga.app@gmail.com';

export const INVALID_CREDENTIALS_MESSAGE = 'Email o contraseña incorrectos.';

/** Fallo de red al consultar la RPC durante el login: no revela que la cuenta está bloqueada. */
export const SIGN_IN_RETRY_MESSAGE = 'No se pudo iniciar sesión. Probá de nuevo.';

/**
 * La pantalla de login y el listener de Auth pueden cerrar la sesión a la vez.
 * Guardamos el aviso solo para el intento de ingreso que ya estaba en curso.
 */
let pendingDeactivationSignOut: { message: string; at: number } | null = null;

export function rememberDeactivationSignOut(message: string) {
  pendingDeactivationSignOut = { message, at: Date.now() };
}

export function takeDeactivationSignOutSince(since: number): string | null {
  const pending = pendingDeactivationSignOut;
  if (!pending || pending.at < since) {
    if (pending && pending.at < since) pendingDeactivationSignOut = null;
    return null;
  }
  pendingDeactivationSignOut = null;
  return pending.message;
}

export type DeactivationOrigin = 'admin' | 'user';

export type DeactivationReasonPayload = {
  deactivated: boolean;
  reason: string | null;
  origin: DeactivationOrigin | null;
  account_blocked: boolean;
  error: 'invalid_credentials' | null;
};

export type DeactivationDecision =
  | { action: 'none' }
  | { action: 'invalid_credentials'; message: string }
  | { action: 'show_deactivation'; message: string; variant: 'admin_reason' | 'generic' };

export function adminDeactivationMessage(reason: string): string {
  return `Su cuenta ha sido dada de baja temporalmente por ${reason}. Para reactivar su cuenta envíe un correo a ${REACTIVATION_EMAIL}`;
}

export function genericDeactivationMessage(): string {
  return `Su cuenta ha sido dada de baja temporalmente. Para reactivar su cuenta envíe un correo a ${REACTIVATION_EMAIL}`;
}

/**
 * Login sin contraseña (OAuth u otro). Ante `user_banned` solo el mensaje genérico:
 * no hay clave para confirmar con la RPC.
 */
export function messageForBannedExternalLogin(err: unknown): string | null {
  if (!isUserBannedAuthError(err)) return null;
  return genericDeactivationMessage();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

export function parseDeactivationReason(raw: unknown): DeactivationReasonPayload | null {
  let value = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  const o = asRecord(value);
  if (!o) return null;
  const hasShape =
    'deactivated' in o ||
    'account_blocked' in o ||
    'reason' in o ||
    'origin' in o ||
    'error' in o;
  if (!hasShape) return null;

  const origin = o.origin === 'admin' || o.origin === 'user' ? o.origin : null;
  const reason =
    typeof o.reason === 'string' && o.reason.trim().length > 0 ? o.reason.trim() : null;
  const error = o.error === 'invalid_credentials' ? 'invalid_credentials' : null;
  return {
    deactivated: o.deactivated === true,
    account_blocked: o.account_blocked === true,
    reason,
    origin,
    error,
  };
}

/**
 * `invalid_credentials` tiene prioridad: no se muestra el motivo aunque venga en el payload.
 * El texto con motivo solo sale si la baja es del admin y hay razón.
 * Origen `user`, u otro bloqueo sin razón, usa el mensaje genérico (mismo correo).
 */
export function decideDeactivation(
  payload: DeactivationReasonPayload | null | undefined,
): DeactivationDecision {
  if (!payload) return { action: 'none' };
  if (payload.error === 'invalid_credentials') {
    return { action: 'invalid_credentials', message: INVALID_CREDENTIALS_MESSAGE };
  }
  const blocked = payload.deactivated || payload.account_blocked;
  if (!blocked) return { action: 'none' };
  if (payload.origin === 'admin' && payload.reason) {
    return {
      action: 'show_deactivation',
      variant: 'admin_reason',
      message: adminDeactivationMessage(payload.reason),
    };
  }
  return {
    action: 'show_deactivation',
    variant: 'generic',
    message: genericDeactivationMessage(),
  };
}

function pushString(target: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) target.push(value);
}

/** GoTrue: código `user_banned` o mensaje "User is banned". */
export function isUserBannedAuthError(err: unknown): boolean {
  if (typeof err === 'string') {
    const m = err.toLowerCase();
    return m === 'user_banned' || m.includes('user is banned') || m.includes('user_banned');
  }
  if (err instanceof Error) {
    if (isUserBannedAuthError({ message: err.message, code: (err as { code?: unknown }).code })) {
      return true;
    }
  }
  const o = asRecord(err);
  if (!o) return false;

  const codes: string[] = [];
  pushString(codes, o.code);
  pushString(codes, o.error_code);
  pushString(codes, o.error);
  if (codes.some((c) => c.toLowerCase() === 'user_banned')) return true;

  const messages: string[] = [];
  pushString(messages, o.message);
  pushString(messages, o.msg);
  pushString(messages, o.error_description);
  return messages.some((m) => {
    const lower = m.toLowerCase();
    return lower.includes('user is banned') || lower.includes('user_banned');
  });
}

/** Cuerpo HTTP de GoTrue / PostgREST que indica usuario baneado. */
export function payloadIndicatesUserBanned(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isUserBannedAuthError(parsed)) return true;
    const o = asRecord(parsed);
    if (o && isUserBannedAuthError(o.error)) return true;
  } catch {
    /* texto plano */
  }
  if (trimmed.length > 500) return false;
  const m = trimmed.toLowerCase();
  return m.includes('"user_banned"') || m.includes('user is banned');
}

export type DeactivationRpc = (
  fn: string,
  args?: Record<string, string>,
) => PromiseLike<{ data: unknown; error: unknown }>;

export async function loadDeactivationReason(
  rpc: DeactivationRpc,
  credentials?: { email: string; password: string },
): Promise<{ payload: DeactivationReasonPayload | null; transportError: unknown | null }> {
  try {
    const res = credentials
      ? await rpc('get_my_deactivation_reason', {
          p_email: credentials.email,
          p_password: credentials.password,
        })
      : await rpc('get_my_deactivation_reason');
    if (res.error) return { payload: null, transportError: res.error };
    return { payload: parseDeactivationReason(res.data), transportError: null };
  } catch (e) {
    return { payload: null, transportError: e };
  }
}

export type BannedPasswordResolution = {
  message: string;
  reason?: 'account_deactivated';
};

/**
 * `signInWithPassword` ya respondió `user_banned` y no hay sesión.
 * La RPC con email+clave decide si la contraseña era válida.
 */
export function resolveBannedPasswordAttempt(loaded: {
  payload: DeactivationReasonPayload | null;
  transportError: unknown | null;
}): BannedPasswordResolution {
  if (loaded.transportError || !loaded.payload) {
    return { message: SIGN_IN_RETRY_MESSAGE };
  }
  const decision = decideDeactivation(loaded.payload);
  if (decision.action === 'invalid_credentials') {
    return { message: decision.message };
  }
  if (decision.action === 'show_deactivation') {
    return { message: decision.message, reason: 'account_deactivated' };
  }
  return { message: genericDeactivationMessage(), reason: 'account_deactivated' };
}

export type SessionDeactivationResolution = {
  signOut: boolean;
  message: string | null;
};

/** Con sesión: `auth.uid()` y sin argumentos. Si el token ya fue revocado, error `user_banned`. */
export function resolveSessionDeactivation(loaded: {
  payload: DeactivationReasonPayload | null;
  transportError: unknown | null;
}): SessionDeactivationResolution {
  if (loaded.payload) {
    const decision = decideDeactivation(loaded.payload);
    if (decision.action === 'show_deactivation') {
      return { signOut: true, message: decision.message };
    }
    return { signOut: false, message: null };
  }
  if (loaded.transportError && isUserBannedAuthError(loaded.transportError)) {
    return { signOut: true, message: genericDeactivationMessage() };
  }
  return { signOut: false, message: null };
}
