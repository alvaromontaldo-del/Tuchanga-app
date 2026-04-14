import type { NavigatorScreenParams } from '@react-navigation/native';

import type { AuthStackParamList } from './types';
import type { MainTabParamList } from './mainTypes';

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  AuthModal: NavigatorScreenParams<AuthStackParamList> | undefined;
};
