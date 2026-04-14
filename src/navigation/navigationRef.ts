import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './rootTypes';

/** Ref raíz: tabs bajo `Main`, auth en modal `AuthModal`. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
