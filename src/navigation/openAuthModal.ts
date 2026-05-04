import { navigationRef } from './navigationRef';
import type { AuthStackParamList } from './types';

export type OpenAuthModalOptions = {
  /** Ej. `worker:<uuid>` — ver `LoginScreen` / `navigateAfterAuthLogin`. */
  redirectTo?: string;
};

export function openAuthModal(
  screen?: keyof AuthStackParamList,
  options?: OpenAuthModalOptions,
) {
  if (!navigationRef.isReady()) return;
  if (!screen) {
    navigationRef.navigate('AuthModal');
    return;
  }

  if (screen === 'Login') {
    const params = options?.redirectTo ? { redirectTo: options.redirectTo } : undefined;
    navigationRef.navigate('AuthModal', { screen: 'Login', params });
    return;
  }

  if (screen === 'Register') {
    navigationRef.navigate('AuthModal', { screen: 'Register' });
    return;
  }

  // ForgotPassword
  navigationRef.navigate('AuthModal', { screen: 'ForgotPassword' });
}

/** Tras login exitoso: navega al destino guardado o al inicio. */
export function navigateAfterAuthLogin(redirectTo?: string) {
  if (!navigationRef.isReady()) return;
  if (redirectTo?.startsWith('worker:')) {
    const id = redirectTo.slice('worker:'.length);
    if (id) {
      navigationRef.navigate('Main', {
        screen: 'Inicio',
        params: { screen: 'WorkerProfile', params: { workerId: id } },
      });
      return;
    }
  }
  navigateToInicioTab();
}

/** Lleva al feed de inicio (tab principal). Útil tras cerrar sesión. */
export function navigateToInicioTab() {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Main', {
    screen: 'Inicio',
    params: { screen: 'Home' },
  });
}

/** Cierra el modal de login/registro y deja el tab en Inicio (evita quedar en Perfil invitado). */
export function closeAuthModalAndGoToInicio() {
  if (!navigationRef.isReady()) return;
  if (navigationRef.canGoBack()) {
    navigationRef.goBack();
  }
  requestAnimationFrame(() => {
    navigateToInicioTab();
  });
}

/** Cierra el modal de auth y aplica `redirectTo` (si existe). */
export function closeAuthModalAndRedirect(redirectTo?: string) {
  if (!navigationRef.isReady()) return;
  if (navigationRef.canGoBack()) {
    navigationRef.goBack();
  }
  requestAnimationFrame(() => {
    navigateAfterAuthLogin(redirectTo);
  });
}
