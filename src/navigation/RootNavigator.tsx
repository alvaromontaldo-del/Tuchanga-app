import { useEffect, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthStack } from './AuthStack';
import { MainTabNavigator } from './MainTabNavigator';
import type { RootStackParamList } from './rootTypes';
import { useAuth } from '../context/AuthContext';
import { FeedProvider } from '../context/FeedContext';
import { SplashLoadingScreen } from '../components/splash/SplashLoadingScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Tiempo mínimo visible de la splash, de forma continua (sin parpadeos). */
const MIN_SPLASH_MS = 2000;
function MainScreen() {
  return (
    <FeedProvider>
      <MainTabNavigator />
    </FeedProvider>
  );
}

/**
 * La app principal está siempre montada; invitados exploran sin sesión.
 * El login/registro se abre en modal (`AuthModal`).
 */
export function RootNavigator() {
  const { isRestoring } = useAuth();
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
        options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}

