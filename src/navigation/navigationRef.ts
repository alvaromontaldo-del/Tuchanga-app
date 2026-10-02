import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './rootTypes';

/** Ref raíz: tabs en `Main`, comercio en `Commerce`, auth en modal `AuthModal`. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
