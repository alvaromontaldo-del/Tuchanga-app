import { describe, expect, it, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const getSession = vi.fn();

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getUser, getSession },
    from: vi.fn(),
  }),
}));

import { validateRemoteAccount } from './sessionValidity';

describe('validateRemoteAccount', () => {
  beforeEach(() => {
    getUser.mockReset();
    getSession.mockReset();
  });

  it('no expulsa si getUser viene vacío pero la sesión local sigue', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
    });
    await expect(validateRemoteAccount('u1')).resolves.toBe(true);
  });

  it('no expulsa si getUser vacío y tampoco hay sesión (carrera post-MP)', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(validateRemoteAccount('u1')).resolves.toBe(true);
  });

  it('expulsa solo si Auth confirma user_not_found', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'User from sub claim in JWT does not exist', code: 'user_not_found' },
    });
    await expect(validateRemoteAccount('u1')).resolves.toBe(false);
  });

  it('acepta si getUser coincide con el id de sesión', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    await expect(validateRemoteAccount('u1')).resolves.toBe(true);
  });
});
