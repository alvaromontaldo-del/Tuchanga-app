import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useWorkerProfile } from './WorkerProfileContext';

type UserModeContextValue = {
  /** True si el usuario tiene servicios registrados (puede publicar). */
  isWorker: boolean;
  /** Oficio mostrado en publicaciones propias (mock hasta perfil real) */
  workerTrade: string;
  setWorkerTrade: (trade: string) => void;
};

const UserModeContext = createContext<UserModeContextValue | null>(null);

export function UserModeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthed, user } = useAuth();
  const { isWorkerRegistered, workerProfile } = useWorkerProfile();
  const [workerTrade, setWorkerTrade] = useState('Profesional');

  const isWorker = useMemo(() => {
    if (!isAuthed) return false;
    if (isWorkerRegistered) return true; // perfil profesional guardado localmente (este dispositivo)
    // Fallback multi-dispositivo: si Supabase trajo jobs + coverage, también es trabajador.
    return Boolean(user?.worker?.trades?.length && (user.worker.coverageKm ?? 0) > 0);
  }, [isAuthed, isWorkerRegistered, user?.worker?.coverageKm, user?.worker?.trades?.length]);

  useEffect(() => {
    // Sincronizar oficio principal para UI (mock) cuando se registra/edita.
    const localPrimary = workerProfile?.trades.find((t) => t.isPrimary);
    const localFirst = workerProfile?.trades?.[0];
    const sbPrimary = user?.worker?.trades?.find((t) => t.isPrimary);
    const sbFirst = user?.worker?.trades?.[0];
    const next = localPrimary?.name ?? localFirst?.name ?? sbPrimary?.name ?? sbFirst?.name;
    if (next) setWorkerTrade(next);
  }, [workerProfile, user?.worker?.trades]);

  const value = useMemo(
    () => ({
      isWorker,
      workerTrade,
      setWorkerTrade,
    }),
    [isWorker, workerTrade],
  );

  return (
    <UserModeContext.Provider value={value}>{children}</UserModeContext.Provider>
  );
}

export function useUserMode() {
  const ctx = useContext(UserModeContext);
  if (!ctx) {
    throw new Error('useUserMode debe usarse dentro de UserModeProvider');
  }
  return ctx;
}
