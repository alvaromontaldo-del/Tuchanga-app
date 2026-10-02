import { useEffect, useRef } from 'react';
import { CommonActions } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useCommerceShell } from '../context/CommerceShellContext';
import { navigationRef } from './navigationRef';
import { focusedRouteName, shellRedirectTarget, shellResetState } from './shellRedirect';

/**
 * Lleva la raíz a `Main` o `Commerce` cuando el rol de sesión cambia.
 * El navigator del otro shell se monta en una ruta nueva, sin el state anidado anterior.
 */
export function useShellRedirect(): void {
  const { isAuthed } = useAuth();
  const { isCommerceShell, loading } = useCommerceShell();
  const pendingTarget = useRef<string | null>(null);

  useEffect(() => {
    // Sin sesión no se espera la carga: tras cerrar sesión en Comercio hay que volver a `Main`.
    if (isAuthed && loading) return;
    pendingTarget.current = null;

    const redirect = () => {
      if (!navigationRef.isReady()) return;
      const rootState = navigationRef.getRootState();
      const target = shellRedirectTarget({
        isAuthed,
        shellLoading: false,
        isCommerceShell,
        focusedRouteName: focusedRouteName(rootState),
        rootRouteNames: rootState?.routes?.map((r) => r.name),
      });
      if (!target) {
        pendingTarget.current = null;
        return;
      }
      // El listener de state puede dispararse antes de que el reset se publique.
      if (pendingTarget.current === target) return;
      pendingTarget.current = target;
      navigationRef.dispatch(CommonActions.reset(shellResetState(target)));
    };

    redirect();
    const unsubscribe = navigationRef.addListener('state', redirect);
    return () => {
      pendingTarget.current = null;
      unsubscribe?.();
    };
  }, [isAuthed, loading, isCommerceShell]);
}
