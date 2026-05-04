import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  /** `redirectTo`: ej. `worker:<uuid>` para volver al perfil tras login. */
  Login: { redirectTo?: string } | undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;
