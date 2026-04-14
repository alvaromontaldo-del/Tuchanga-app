import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useWorkerProfile } from './WorkerProfileContext';

type UserModeContextValue = {
  /** Si es true, el usuario actúa como trabajador (ve botón Publicar, etc.) */
  isWorkerMode: boolean;
  setWorkerMode: (value: boolean) => void;
  /** Oficio mostrado en publicaciones propias (mock hasta perfil real) */
  workerTrade: string;
  setWorkerTrade: (trade: string) => void;
};

const UserModeContext = createContext<UserModeContextValue | null>(null);

export function UserModeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthed } = useAuth();
  const { isWorkerRegistered, workerProfile } = useWorkerProfile();
  const [isWorkerMode, setWorkerMode] = useState(false);
  const [workerTrade, setWorkerTrade] = useState('Profesional');

  useEffect(() => {
    if (!isAuthed && isWorkerMode) {
      setWorkerMode(false);
    }
  }, [isAuthed, isWorkerMode]);

  useEffect(() => {
    // Si no está registrado como trabajador, forzar modo cliente.
    if (!isWorkerRegistered && isWorkerMode) {
      setWorkerMode(false);
    }
  }, [isWorkerRegistered, isWorkerMode]);

  useEffect(() => {
    // Sincronizar oficio principal para UI (mock) cuando se registra/edita.
    const primary = workerProfile?.trades.find((t) => t.isPrimary);
    if (primary?.name) setWorkerTrade(primary.name);
  }, [workerProfile]);

  const value = useMemo(
    () => ({
      isWorkerMode,
      setWorkerMode: (value: boolean) => {
        if (value && !isAuthed) return;
        if (value && !isWorkerRegistered) return;
        setWorkerMode(value);
      },
      workerTrade,
      setWorkerTrade,
    }),
    [isAuthed, isWorkerMode, isWorkerRegistered, workerTrade],
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
