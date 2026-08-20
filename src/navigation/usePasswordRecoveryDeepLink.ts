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
    return subscribeToPasswordRecoveryDeepLinks(
      ({ email, user }) => {
        void signIn(user, true);
        const go = () => {
          navigationRef.navigate('AuthModal', {
            screen: 'ResetPassword',
            params: { email, verifiedViaLink: true },
          });
        };
        if (navigationRef.isReady()) go();
        else {
          const id = setInterval(() => {
            if (navigationRef.isReady()) {
              clearInterval(id);
              go();
            }
          }, 120);
          setTimeout(() => clearInterval(id), 8000);
        }
      },
      (message) => {
        console.warn('[authDeepLink]', message);
      },
    );
  }, [signIn]);
}
