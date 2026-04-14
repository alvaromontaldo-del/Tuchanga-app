import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';

export type WorkerTrade = {
  id: string;
  name: string;
  /** Slug del catálogo `rubros.json` (opcional si es texto heredado). */
  rubroSlug?: string;
  isPrimary: boolean;
  yearsExperience: number;
  description: string;
};

export type WorkerBaseLocation = {
  address: string;
  lat: number;
  lng: number;
};

export type WorkerProfile = {
  professionalDescription: string;
  baseLocation: WorkerBaseLocation;
  /** Radio de cobertura en km (1–300). */
  coverageKm: number;
  trades: WorkerTrade[]; // max 5
  /** Detalle libre (barrios, notas). */
  coverageDetail?: string;
  /** Fotos de trabajos realizados (opcional). */
  portfolioImageUrls?: string[];
  /** Nº de matrícula si aplica (gasista, electricista, etc.). */
  professionalLicense?: string;
};

type WorkerProfileContextValue = {
  workerProfile: WorkerProfile | null;
  isWorkerRegistered: boolean;
  saveWorkerProfile: (profile: WorkerProfile) => Promise<void>;
  deleteWorkerProfile: () => Promise<void>;
};

const WorkerProfileContext = createContext<WorkerProfileContextValue | null>(null);

const KEY_PREFIX = 'tu-changa:worker-profile:v1';

function storageKeyForUser(userId: string) {
  return `${KEY_PREFIX}:${userId}`;
}

const DEFAULT_LOCATION: WorkerBaseLocation = {
  address: 'Buenos Aires, Argentina',
  lat: -34.6037,
  lng: -58.3816,
};

function safeJsonParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseTrades(raw: unknown): WorkerTrade[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean).map((t) => {
    const o = t as Record<string, unknown>;
    return {
      id: String(o.id ?? `t_${Math.random().toString(16).slice(2)}`),
      name: String(o.name ?? ''),
      rubroSlug: typeof o.rubroSlug === 'string' ? o.rubroSlug : undefined,
      isPrimary: Boolean(o.isPrimary),
      yearsExperience: Math.floor(Number(o.yearsExperience) || 0),
      description: String(o.description ?? ''),
    };
  });
}

function migrateStoredProfile(parsed: Record<string, unknown>): WorkerProfile {
  const trades = parseTrades(parsed.trades);
  const bl = parsed.baseLocation;
  let baseLocation: WorkerBaseLocation = DEFAULT_LOCATION;
  if (
    bl &&
    typeof bl === 'object' &&
    typeof (bl as WorkerBaseLocation).address === 'string' &&
    typeof (bl as WorkerBaseLocation).lat === 'number' &&
    typeof (bl as WorkerBaseLocation).lng === 'number'
  ) {
    const b = bl as WorkerBaseLocation;
    baseLocation = {
      address: b.address.trim() || DEFAULT_LOCATION.address,
      lat: b.lat,
      lng: b.lng,
    };
  }

  let coverageKm = Math.floor(Number(parsed.coverageKm) || 0);
  if (!Number.isFinite(coverageKm) || coverageKm < 1) coverageKm = 10;
  coverageKm = Math.min(300, Math.max(1, coverageKm));

  return {
    professionalDescription: String(parsed.professionalDescription ?? ''),
    baseLocation,
    coverageKm,
    trades,
    coverageDetail:
      typeof parsed.coverageDetail === 'string' ? parsed.coverageDetail : undefined,
    portfolioImageUrls: Array.isArray(parsed.portfolioImageUrls)
      ? (parsed.portfolioImageUrls as string[])
      : undefined,
    professionalLicense:
      typeof parsed.professionalLicense === 'string'
        ? parsed.professionalLicense
        : undefined,
  };
}

async function webGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function webSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

async function webRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function WorkerProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [workerProfile, setWorkerProfile] = useState<WorkerProfile | null>(null);

  useEffect(() => {
    let mounted = true;
    // Al cambiar de usuario, limpiar inmediatamente para no “heredar” datos del usuario previo.
    setWorkerProfile(null);
    (async () => {
      if (!userId) {
        return;
      }
      const key = storageKeyForUser(userId);
      const raw =
        Platform.OS === 'web' ? await webGet(key) : await AsyncStorage.getItem(key);
      const parsed = safeJsonParse(raw);
      if (!mounted || !parsed || typeof parsed !== 'object') {
        if (mounted) setWorkerProfile(null);
        return;
      }
      if (mounted) setWorkerProfile(migrateStoredProfile(parsed as Record<string, unknown>));
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  async function saveWorkerProfile(profile: WorkerProfile) {
    if (!userId) throw new Error('No hay sesión iniciada.');
    const key = storageKeyForUser(userId);
    const raw = JSON.stringify(profile);
    if (Platform.OS === 'web') {
      await webSet(key, raw);
    } else {
      await AsyncStorage.setItem(key, raw);
    }
    setWorkerProfile(profile);
  }

  async function deleteWorkerProfile() {
    if (!userId) {
      setWorkerProfile(null);
      return;
    }
    const key = storageKeyForUser(userId);
    if (Platform.OS === 'web') {
      await webRemove(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
    setWorkerProfile(null);
  }

  const value = useMemo(
    () => ({
      workerProfile,
      isWorkerRegistered: Boolean(workerProfile),
      saveWorkerProfile,
      deleteWorkerProfile,
    }),
    // `saveWorkerProfile`/`deleteWorkerProfile` cierran sobre `userId`.
    // Si no incluimos `userId`, el consumidor puede quedarse con una versión vieja (p.ej. userId=null)
    // y fallar con "No hay sesión iniciada" aunque la sesión exista.
    [workerProfile, userId],
  );

  return (
    <WorkerProfileContext.Provider value={value}>{children}</WorkerProfileContext.Provider>
  );
}

export function useWorkerProfile() {
  const ctx = useContext(WorkerProfileContext);
  if (!ctx) {
    throw new Error('useWorkerProfile debe usarse dentro de WorkerProfileProvider');
  }
  return ctx;
}
