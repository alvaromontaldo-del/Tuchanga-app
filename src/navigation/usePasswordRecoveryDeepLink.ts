import { useEffect } from 'react';
import type { AuthUser } from '../services/auth';
import { navigationRef } from './navigationRef';
import { subscribeToPasswordRecoveryDeepLinks } from '../services/authDeepLink';

/**
 * Abre ResetPassword cuando el usuario toca el enlace del email (deep link).
 */
export function usePasswordRecoveryDeepLink(
  signIn: (user: AuthUser, keepSignedIn: boolean) => Promise<void>,
) {
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setInterval>>();
    const unsub = subscribeToPasswordRecoveryDeepLinks(
      ({ email, user }) => {
        void signIn(user, true).catch(() => undefined);
        const go = () => {
          try {
            navigationRef.navigate('AuthModal', {
              screen: 'ResetPassword',
              params: { email, verifiedViaLink: true },
            });
          } catch (e) {
            console.warn('[authDeepLink] navigate', e);
          }
        };
        if (navigationRef.isReady()) go();
        else {
          const id = setInterval(() => {
            if (navigationRef.isReady()) {
              clearInterval(id);
              timers.delete(id);
              go();
            }
          }, 120);
          timers.add(id);
          const stop = setTimeout(() => {
            clearInterval(id);
            timers.delete(id);
          }, 8000);
          timers.add(stop);
        }
      },
      (message) => {
        console.warn('[authDeepLink]', message);
      },
    );
    return () => {
      unsub();
      for (const id of timers) {
        clearInterval(id);
        clearTimeout(id);
      }
      timers.clear();
    };
  }, [signIn]);
}
