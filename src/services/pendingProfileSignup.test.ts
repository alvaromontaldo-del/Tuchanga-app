import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignUpPayload } from './auth';

const memory = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: async (key: string) => {
      memory.delete(key);
    },
  },
}));

vi.mock('../config/supabase', () => ({
  isSupabaseConfigured: () => true,
}));

const persistSignUpToSupabase = vi.fn();
vi.mock('./supabaseUser', () => ({
  persistSignUpToSupabase: (...args: unknown[]) => persistSignUpToSupabase(...args),
}));

const registerMyStore = vi.fn();
const fetchMyStoresDetailed = vi.fn();
vi.mock('./storeRegistrationSupabase', () => ({
  registerMyStore: (...args: unknown[]) => registerMyStore(...args),
  fetchMyStoresDetailed: (...args: unknown[]) => fetchMyStoresDetailed(...args),
}));

const updateMyStoreAvatarFromUri = vi.fn();
vi.mock('./storeQuotesSupabase', () => ({
  updateMyStoreAvatarFromUri: (...args: unknown[]) => updateMyStoreAvatarFromUri(...args),
}));

vi.mock('./termsAcceptance', () => ({
  acceptCurrentTerms: vi.fn(async () => 'saved'),
}));

import { savePendingProfileSignup, tryApplyPendingProfileSignup } from './pendingProfileSignup';

function payload(): SignUpPayload {
  return {
    firstName: 'Ana',
    lastName: 'Paz',
    dni: '30111222',
    avatarUri: 'file://avatar.jpg',
    email: 'ana@example.com',
    password: 'secret1',
    phone: '+5491111111111',
    baseLocation: { address: 'Calle 1', lat: -34.6, lng: -58.4 },
    birthDate: '1990-01-01',
    offerServices: false,
    pendingCommerce: {
      name: 'Ferretería El Tornillo',
      phone: '+5491111111111',
      address: 'Calle 1',
      latitude: -34.6,
      longitude: -58.4,
      rubroIds: ['rubro-1'],
      openingHours: [
        { day: 1, closed: false, slots: [{ open: '09:00', close: '18:00' }] },
        { day: 2, closed: false, slots: [{ open: '09:00', close: '18:00' }] },
        { day: 3, closed: false, slots: [{ open: '09:00', close: '18:00' }] },
        { day: 4, closed: false, slots: [{ open: '09:00', close: '18:00' }] },
        { day: 5, closed: false, slots: [{ open: '09:00', close: '18:00' }] },
        { day: 6, closed: false, slots: [{ open: '09:00', close: '13:00' }] },
        { day: 7, closed: true, slots: [{ open: '09:00', close: '18:00' }] },
      ],
      avatarUri: 'file://logo.jpg',
    },
  };
}

describe('signup pendiente de comercio', () => {
  beforeEach(() => {
    memory.clear();
    persistSignUpToSupabase.mockReset();
    persistSignUpToSupabase.mockResolvedValue(undefined);
    registerMyStore.mockReset();
    registerMyStore.mockResolvedValue({
      id: 'store-1',
      name: 'Ferretería El Tornillo',
      status: 'pending_approval',
    });
    fetchMyStoresDetailed.mockReset();
    fetchMyStoresDetailed.mockResolvedValue([
      {
        id: 'store-1',
        name: 'Ferretería El Tornillo',
        status: 'pending_approval',
        avatarUrl: null,
      },
    ]);
    updateMyStoreAvatarFromUri.mockReset();
    updateMyStoreAvatarFromUri.mockResolvedValue('https://cdn.example/logo.jpg');
  });

  it('crea el comercio con el horario en el primer login', async () => {
    await savePendingProfileSignup('user-1', payload());
    await tryApplyPendingProfileSignup('user-1');

    expect(persistSignUpToSupabase).toHaveBeenCalledTimes(1);
    expect(persistSignUpToSupabase).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Ana',
        lastName: 'Paz',
        avatarUri: 'file://avatar.jpg',
        phone: '+5491111111111',
        baseLocation: { address: 'Calle 1', lat: -34.6, lng: -58.4 },
      }),
      'user-1',
    );
    expect(registerMyStore).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ferretería El Tornillo',
        phone: '+5491111111111',
        address: 'Calle 1',
        latitude: -34.6,
        longitude: -58.4,
        rubroIds: ['rubro-1'],
      }),
    );
    expect(updateMyStoreAvatarFromUri).toHaveBeenCalledWith('store-1', 'file://logo.jpg');

    registerMyStore.mockClear();
    await tryApplyPendingProfileSignup('user-1');
    expect(registerMyStore).not.toHaveBeenCalled();
  });

  it('reintenta el alta si crear el comercio falla por red', async () => {
    registerMyStore.mockRejectedValueOnce(new Error('network'));
    await savePendingProfileSignup('user-2', payload());
    await tryApplyPendingProfileSignup('user-2');
    expect(registerMyStore).toHaveBeenCalledTimes(1);

    await tryApplyPendingProfileSignup('user-2');
    expect(registerMyStore).toHaveBeenCalledTimes(2);
  });

  it('no vuelve a pedir los datos si el comercio ya existe', async () => {
    registerMyStore.mockRejectedValueOnce(
      new Error('Ya tenés un comercio pendiente de aprobación.'),
    );
    await savePendingProfileSignup('user-3', payload());
    await tryApplyPendingProfileSignup('user-3');
    expect(updateMyStoreAvatarFromUri).toHaveBeenCalledWith('store-1', 'file://logo.jpg');

    registerMyStore.mockClear();
    updateMyStoreAvatarFromUri.mockClear();
    await tryApplyPendingProfileSignup('user-3');
    expect(registerMyStore).not.toHaveBeenCalled();
    expect(updateMyStoreAvatarFromUri).not.toHaveBeenCalled();
  });

  it('reintenta la foto del comercio si la subida falla en el primer login', async () => {
    updateMyStoreAvatarFromUri.mockRejectedValueOnce(new Error('network'));
    await savePendingProfileSignup('user-4', payload());
    await tryApplyPendingProfileSignup('user-4');
    expect(updateMyStoreAvatarFromUri).toHaveBeenCalledTimes(1);

    registerMyStore.mockRejectedValueOnce(
      new Error('Ya tenés un comercio pendiente de aprobación.'),
    );
    await tryApplyPendingProfileSignup('user-4');
    expect(updateMyStoreAvatarFromUri).toHaveBeenCalledTimes(2);
    expect(updateMyStoreAvatarFromUri).toHaveBeenLastCalledWith('store-1', 'file://logo.jpg');
  });
});
