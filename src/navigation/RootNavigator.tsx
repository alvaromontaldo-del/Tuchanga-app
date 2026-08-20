import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../constants/theme';

import { AuthStack } from './AuthStack';
import { MainTabNavigator } from './MainTabNavigator';
import { CommerceStack } from './CommerceStack';
import type { RootStackParamList } from './rootTypes';
import { useAuth } from '../context/AuthContext';
import { useCommerceShell } from '../context/CommerceShellContext';
import { usePasswordRecoveryDeepLink } from './usePasswordRecoveryDeepLink';
import { FeedProvider } from '../context/FeedContext';
import { SplashLoadingScreen } from '../components/splash/SplashLoadingScreen';
import { SessionRolePickerModal } from '../components/auth/SessionRolePickerModal';
import { PagoCheckoutScreen } from '../screens/pagos/PagoCheckoutScreen';
import { PagoRetornoScreen } from '../screens/pagos/PagoRetornoScreen';
import { usePagoRetornoDeepLink } from './usePagoRetornoDeepLink';

const Stack = createNativeStackNavigator<RootStackParamList>();

const MIN_SPLASH_MS = 2000;

function MainScreen() {
  const { isAuthed } = useAuth();
  const { isCommerceShell, loading } = useCommerceShell();

  if (isAuthed && loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isAuthed && isCommerceShell) {
    return (
      <>
        <CommerceStack />
        <SessionRolePickerModal />
      </>
    );
  }

  return (
    <FeedProvider>
      <MainTabNavigator />
      <SessionRolePickerModal />
    </FeedProvider>
  );
}

/**
 * La app principal está siempre montada; invitados exploran sin sesión.
 * Login/registro en modal. Comercio aprobado/pendiente → shell solo-comercio.
 */
export function RootNavigator() {
  const { isRestoring, signIn } = useAuth();
  usePasswordRecoveryDeepLink(signIn);
  usePagoRetornoDeepLink();
  const restoreStartedAt = useRef<number | null>(null);
  const releaseSplashAt = useRef<number | null>(null);
  const wasRestoring = useRef(false);
  const [, setReleaseTick] = useState(0);

  if (isRestoring) {
    releaseSplashAt.current = null;
    if (!wasRestoring.current) {
      restoreStartedAt.current = Date.now();
    }
  } else if (wasRestoring.current) {
    const started = restoreStartedAt.current;
    if (started !== null) {
      const releaseAt = started + MIN_SPLASH_MS;
      if (Date.now() >= releaseAt) {
        restoreStartedAt.current = null;
        releaseSplashAt.current = null;
      } else {
        releaseSplashAt.current = releaseAt;
      }
    }
  }
  wasRestoring.current = isRestoring;

  const splashHeld =
    releaseSplashAt.current !== null && Date.now() < releaseSplashAt.current;
  const showSplash = isRestoring || splashHeld;

  useEffect(() => {
    if (!splashHeld || releaseSplashAt.current === null) return;
    const ms = releaseSplashAt.current - Date.now();
    if (ms <= 0) {
      restoreStartedAt.current = null;
      releaseSplashAt.current = null;
      setReleaseTick((n) => n + 1);
      return;
    }
    const id = setTimeout(() => {
      restoreStartedAt.current = null;
      releaseSplashAt.current = null;
      setReleaseTick((n) => n + 1);
    }, ms);
    return () => clearTimeout(id);
  }, [isRestoring, splashHeld]);

  if (showSplash) {
    return <SplashLoadingScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainScreen} />
      <Stack.Screen
        name="AuthModal"
        component={AuthStack}
        options={{
          presentation: Platform.OS === 'ios' ? 'fullScreenModal' : 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <Stack.Screen
        name="PagoCheckout"
        component={PagoCheckoutScreen}
        options={{
          presentation: Platform.OS === 'ios' ? 'fullScreenModal' : 'card',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="PagoRetorno"
        component={PagoRetornoScreen}
        options={{
          presentation: Platform.OS === 'ios' ? 'fullScreenModal' : 'card',
          headerShown: false,
          animation: 'fade',
        }}
      />
    </Stack.Navigator>
  );
}
