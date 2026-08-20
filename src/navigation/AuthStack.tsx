import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ForgotPasswordRequestScreen } from '../screens/auth/ForgotPasswordRequestScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { RegisterCommerceScreen } from '../screens/auth/RegisterCommerceScreen';
import { colors } from '../constants/theme';
import type { AuthStackParamList } from './types';
import { useNativeStackScreenOptions } from './useNativeStackScreenOptions';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * Navegación entre Login, Registro y Recuperación de contraseña.
 */
export function AuthStack() {
  const screenOptions = useNativeStackScreenOptions({
    headerStyle: { backgroundColor: colors.surface },
    contentStyle: { backgroundColor: colors.background },
  });

  return (
    <Stack.Navigator initialRouteName="Login" screenOptions={screenOptions}>
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RegisterCommerce"
        component={RegisterCommerceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ForgotPasswordRequest"
        component={ForgotPasswordRequestScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
