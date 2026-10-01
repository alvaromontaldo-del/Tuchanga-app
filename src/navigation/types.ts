import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  /** `redirectTo`: ej. `worker:<uuid>`. `asCommerce`: login/registro orientado a comercio. */
  Login: { redirectTo?: string; asCommerce?: boolean } | undefined;
  /** Registro cliente/profesional. Con `asCommerce` adapta copy y destino. `asProfessional` abre los oficios. */
  Register: { redirectTo?: string; asCommerce?: boolean; asProfessional?: boolean } | undefined;
  /** Entrada al flujo de comercio (no el ABM de cliente/trabajador). */
  RegisterCommerce: undefined;
  ForgotPasswordRequest: undefined;
  ResetPassword: { email: string; verifiedViaLink?: boolean; otpSentAt?: number };
};

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;
