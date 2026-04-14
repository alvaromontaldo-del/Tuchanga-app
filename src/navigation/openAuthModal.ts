import { navigationRef } from './navigationRef';
import type { AuthStackParamList } from './types';

export function openAuthModal(screen?: keyof AuthStackParamList) {
  if (!navigationRef.isReady()) return;
  if (screen) {
    navigationRef.navigate('AuthModal', { screen });
  } else {
    navigationRef.navigate('AuthModal');
  }
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
