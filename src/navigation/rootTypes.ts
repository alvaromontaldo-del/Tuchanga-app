import type { NavigatorScreenParams } from '@react-navigation/native';

import type { AuthStackParamList } from './types';
import type { MainTabParamList } from './mainTypes';

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  AuthModal: NavigatorScreenParams<AuthStackParamList> | undefined;
  PagoCheckout: {
    checkoutUrl: string;
    sandbox?: boolean;
    conversationId?: string;
    contratacionId?: string;
    materialOrderId?: string;
  };
  PagoRetorno: {
    status: 'approved' | 'pending' | 'failure';
    conversationId?: string;
    mpPaymentId?: string;
    contratacionId?: string;
    materialOrderId?: string;
  };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = import('@react-navigation/native-stack').NativeStackScreenProps<
  RootStackParamList,
  T
>;
