import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppErrorBoundary } from './src/components/common/AppErrorBoundary';
import { configureAndroidSystemBars } from './src/navigation/configureAndroidSystemBars';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { CommerceShellProvider } from './src/context/CommerceShellContext';
import { SocketProvider } from './src/context/SocketContext';
import { UnreadMessagesProvider } from './src/context/UnreadMessagesContext';
import { UserModeProvider } from './src/context/UserModeContext';
import { WorkerProfileProvider } from './src/context/WorkerProfileContext';
import { FavoritesProvider } from './src/context/FavoritesContext';
import { ToastProvider } from './src/components/toast/ToastProvider';
import { navigationRef } from './src/navigation/navigationRef';
import { RootNavigator } from './src/navigation/RootNavigator';
import { initNotificationHandlerOnce } from './src/services/notificationsInit';
import { initNotificationRoutingOnce } from './src/services/notificationRouting';
import { useOtaUpdates } from './src/hooks/useOtaUpdates';

export default function App() {
  useOtaUpdates();

  useEffect(() => {
    configureAndroidSystemBars();
    initNotificationHandlerOnce();
    initNotificationRoutingOnce();
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppErrorBoundary>
        <ToastProvider>
          <AuthProvider>
            <CommerceShellProvider>
              <WorkerProfileProvider>
                <FavoritesProvider>
                  <UserModeProvider>
                    <UnreadMessagesProvider>
                      <NavigationContainer ref={navigationRef}>
                        <SocketProvider>
                          <RootNavigator />
                        </SocketProvider>
                      </NavigationContainer>
                    </UnreadMessagesProvider>
                    <StatusBar style="dark" />
                  </UserModeProvider>
                </FavoritesProvider>
              </WorkerProfileProvider>
            </CommerceShellProvider>
          </AuthProvider>
        </ToastProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
