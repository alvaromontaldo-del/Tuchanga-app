import { describe, expect, it, vi } from 'vitest';
import {
  INVALID_CREDENTIALS_MESSAGE,
  REACTIVATION_EMAIL,
  SIGN_IN_RETRY_MESSAGE,
  adminDeactivationMessage,
  decideDeactivation,
  genericDeactivationMessage,
  isUserBannedAuthError,
  loadDeactivationReason,
  messageForBannedExternalLogin,
  parseDeactivationReason,
  payloadIndicatesUserBanned,
  rememberDeactivationSignOut,
  resolveBannedPasswordAttempt,
  resolveSessionDeactivation,
  takeDeactivationSignOutSince,
  type DeactivationReasonPayload,
} from './accountDeactivation';

const REASON = 'incumplimiento de las normas';

function payload(partial: Partial<DeactivationReasonPayload>): DeactivationReasonPayload {
  return {
    deactivated: false,
    reason: null,
    origin: null,
    account_blocked: false,
    error: null,
    ...partial,
  };
}

describe('decideDeactivation', () => {
  it('arma el mensaje del admin con el motivo y el correo de reactivación', () => {
    const message = adminDeactivationMessage(REASON);
    expect(message).toBe(
      `Su cuenta ha sido dada de baja temporalmente por ${REASON}. Para reactivar su cuenta envíe un correo a ${REACTIVATION_EMAIL}`,
    );
    const decision = decideDeactivation(
      payload({ deactivated: true, origin: 'admin', reason: REASON }),
    );
    expect(decision).toEqual({
      action: 'show_deactivation',
      variant: 'admin_reason',
      message,
    });
  });

  it('usa el motivo también si solo account_blocked está en true', () => {
    const parsed = parseDeactivationReason({
      deactivated: false,
      account_blocked: true,
      origin: 'admin',
      reason: '  falta de pago  ',
      error: null,
    });
    const decision = decideDeactivation(parsed);
    expect(decision).toMatchObject({
      action: 'show_deactivation',
      variant: 'admin_reason',
      message: adminDeactivationMessage('falta de pago'),
    });
  });

  it('no revela el motivo si la RPC dice invalid_credentials', () => {
    const decision = decideDeactivation(
      payload({
        deactivated: true,
        account_blocked: true,
        origin: 'admin',
        reason: REASON,
        error: 'invalid_credentials',
      }),
    );
    expect(decision).toEqual({
      action: 'invalid_credentials',
      message: INVALID_CREDENTIALS_MESSAGE,
    });
    if (decision.action !== 'invalid_credentials') return;
    expect(decision.message).not.toContain(REASON);
    expect(decision.message).not.toContain(REACTIVATION_EMAIL);
  });

  it('mensaje genérico si está bloqueada sin motivo', () => {
    const decision = decideDeactivation(
      payload({ deactivated: true, origin: 'admin', reason: null }),
    );
    expect(decision).toEqual({
      action: 'show_deactivation',
      variant: 'generic',
      message: genericDeactivationMessage(),
    });
    expect(genericDeactivationMessage()).toContain(REACTIVATION_EMAIL);
    expect(genericDeactivationMessage()).not.toContain('por ');
  });

  it('origen user no muestra el motivo aunque venga en el payload', () => {
    const decision = decideDeactivation(
      payload({ account_blocked: true, origin: 'user', reason: 'me di de baja' }),
    );
    expect(decision.action).toBe('show_deactivation');
    if (decision.action !== 'show_deactivation') return;
    expect(decision.variant).toBe('generic');
    expect(decision.message).toBe(genericDeactivationMessage());
    expect(decision.message).not.toContain('me di de baja');
    expect(decision.message).toContain(REACTIVATION_EMAIL);
  });

  it('no hace nada si la cuenta no está bloqueada', () => {
    expect(decideDeactivation(payload({ origin: 'admin', reason: REASON }))).toEqual({
      action: 'none',
    });
    expect(decideDeactivation(null)).toEqual({ action: 'none' });
  });
});

describe('parseDeactivationReason', () => {
  it('acepta jsonb objeto o string y descarta razón en blanco', () => {
    expect(
      parseDeactivationReason({
        deactivated: true,
        reason: '   ',
        origin: 'admin',
        account_blocked: false,
        error: null,
      }),
    ).toMatchObject({ deactivated: true, reason: null, origin: 'admin' });

    expect(
      parseDeactivationReason(
        JSON.stringify({
          deactivated: false,
          account_blocked: true,
          reason: REASON,
          origin: 'admin',
          error: null,
        }),
      ),
    ).toMatchObject({ account_blocked: true, reason: REASON, origin: 'admin' });
  });

  it('ignora payloads que no son el contrato', () => {
    expect(parseDeactivationReason(null)).toBeNull();
    expect(parseDeactivationReason('no-json')).toBeNull();
    expect(parseDeactivationReason({ user: 'x' })).toBeNull();
  });
});

describe('resolveBannedPasswordAttempt', () => {
  it('contraseña mal escrita: mensaje normal, sin motivo', () => {
    const resolved = resolveBannedPasswordAttempt({
      transportError: null,
      payload: payload({
        deactivated: true,
        origin: 'admin',
        reason: REASON,
        error: 'invalid_credentials',
      }),
    });
    expect(resolved).toEqual({ message: INVALID_CREDENTIALS_MESSAGE });
    expect(resolved.reason).toBeUndefined();
  });

  it('contraseña correcta y baja de admin: muestra el motivo', () => {
    const resolved = resolveBannedPasswordAttempt({
      transportError: null,
      payload: payload({ deactivated: true, origin: 'admin', reason: REASON }),
    });
    expect(resolved.reason).toBe('account_deactivated');
    expect(resolved.message).toBe(adminDeactivationMessage(REASON));
  });

  it('si la RPC falla no revela la baja', () => {
    expect(
      resolveBannedPasswordAttempt({
        transportError: { message: 'User is banned', code: 'user_banned' },
        payload: null,
      }),
    ).toEqual({ message: SIGN_IN_RETRY_MESSAGE });
  });
});

describe('resolveSessionDeactivation', () => {
  it('cierra sesión con el motivo del admin', () => {
    expect(
      resolveSessionDeactivation({
        transportError: null,
        payload: payload({ deactivated: true, origin: 'admin', reason: REASON }),
      }),
    ).toEqual({ signOut: true, message: adminDeactivationMessage(REASON) });
  });

  it('token ya revocado: mensaje genérico y cierre', () => {
    expect(
      resolveSessionDeactivation({
        payload: null,
        transportError: { code: 'user_banned', message: 'User is banned' },
      }),
    ).toEqual({ signOut: true, message: genericDeactivationMessage() });
  });

  it('error de red sin señal de ban: no expulsa', () => {
    expect(
      resolveSessionDeactivation({
        payload: null,
        transportError: { message: 'Failed to fetch' },
      }),
    ).toEqual({ signOut: false, message: null });
  });
});

describe('isUserBannedAuthError', () => {
  it('detecta código y mensaje de GoTrue', () => {
    expect(isUserBannedAuthError({ code: 'user_banned', message: 'User is banned' })).toBe(true);
    expect(isUserBannedAuthError({ error_code: 'user_banned', msg: 'User is banned' })).toBe(true);
    expect(isUserBannedAuthError(new Error('User is banned'))).toBe(true);
    expect(isUserBannedAuthError({ message: 'Invalid login credentials' })).toBe(false);
    expect(isUserBannedAuthError({ code: 401, message: 'JWT expired' })).toBe(false);
  });

  it('login externo solo ofrece el mensaje genérico', () => {
    expect(messageForBannedExternalLogin({ message: 'User is banned' })).toBe(
      genericDeactivationMessage(),
    );
    expect(messageForBannedExternalLogin({ message: 'Invalid login credentials' })).toBeNull();
  });
});

describe('payloadIndicatesUserBanned', () => {
  it('reconoce los cuerpos habituales de GoTrue', () => {
    expect(
      payloadIndicatesUserBanned(
        JSON.stringify({ error: 'user_banned', error_description: 'User is banned' }),
      ),
    ).toBe(true);
    expect(payloadIndicatesUserBanned(JSON.stringify({ code: 'user_banned', message: 'User is banned' }))).toBe(
      true,
    );
    expect(payloadIndicatesUserBanned('{"message":"Invalid login credentials"}')).toBe(false);
    expect(payloadIndicatesUserBanned('x'.repeat(600))).toBe(false);
  });
});

describe('rememberDeactivationSignOut', () => {
  it('solo lo consume el intento de login que ya había empezado', () => {
    const before = Date.now();
    expect(takeDeactivationSignOutSince(before)).toBeNull();
    rememberDeactivationSignOut('aviso');
    const after = Date.now() + 5;
    expect(takeDeactivationSignOutSince(after)).toBeNull();
    rememberDeactivationSignOut('aviso');
    expect(takeDeactivationSignOutSince(before)).toBe('aviso');
    expect(takeDeactivationSignOutSince(before)).toBeNull();
  });
});

describe('loadDeactivationReason', () => {
  it('con sesión no manda argumentos', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { deactivated: false, reason: null, origin: null, account_blocked: false, error: null },
      error: null,
    });
    await loadDeactivationReason(rpc);
    expect(rpc).toHaveBeenCalledWith('get_my_deactivation_reason');
  });

  it('sin sesión manda email y contraseña del intento', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { error: 'invalid_credentials', deactivated: true, reason: REASON, origin: 'admin', account_blocked: true },
      error: null,
    });
    const loaded = await loadDeactivationReason(rpc, { email: 'a@b.com', password: 'mal' });
    expect(rpc).toHaveBeenCalledWith('get_my_deactivation_reason', {
      p_email: 'a@b.com',
      p_password: 'mal',
    });
    expect(decideDeactivation(loaded.payload).action).toBe('invalid_credentials');
  });
});
